# ============================================================================
# SETUP & INSTALLATION
# ============================================================================
import subprocess
import sys
import os
import base64
from concurrent.futures import ThreadPoolExecutor
import multiprocessing
import json
import time

# FORCE UNBUFFERED OUTPUT (CRITICAL FOR STREAMING)
sys.stdout.reconfigure(line_buffering=True)

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Try to load environment variables from .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def setup_environment(uploads_base_dir=None):
    if uploads_base_dir is None:
        uploads_base_dir = os.path.join(os.path.dirname(__file__), 'uploads')
    
    os.makedirs(uploads_base_dir, exist_ok=True)
    frames_dir = os.path.join(uploads_base_dir, 'frames')
    photos_dir = os.path.join(uploads_base_dir, 'stop_photos')
    videos_dir = os.path.join(uploads_base_dir, 'videos')
    
    os.makedirs(frames_dir, exist_ok=True)
    os.makedirs(photos_dir, exist_ok=True)
    os.makedirs(videos_dir, exist_ok=True)
    
    return uploads_base_dir, frames_dir, photos_dir, videos_dir

UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR = setup_environment()
OUTPUT_DIR = UPLOADS_BASE_DIR

# --- SILENT MODE INSTALLER ---
def install_system_packages():
    if sys.platform == 'win32': return
    try:
        subprocess.run(['apt-get', 'update'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['apt-get', 'install', '-y', 'chromium-browser', 'chromium-chromedriver', 'ffmpeg'], 
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass

def install_python_packages():
    try:
        import pandas, numpy, imageio, PIL, scipy, selenium
        return
    except ImportError:
        pass
    packages = ['selenium', 'pandas', 'numpy', 'pyproj', 'imageio', 'imageio-ffmpeg', 'pillow', 'requests', 'openpyxl', 'scipy', 'webdriver-manager']
    subprocess.run([sys.executable, 'pip', 'install', '-q'] + packages, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

install_system_packages()
install_python_packages()

# ============================================================================
# IMPORTS & UTILS
# ============================================================================
import math
from io import BytesIO
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
import imageio.v2 as imageio
from PIL import Image, ImageDraw, ImageFont
import requests
from scipy.ndimage import gaussian_filter1d
from pyproj import Geod
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from webdriver_manager.core.os_manager import ChromeType

# --- CRITICAL: DISABLE TQDM FOR WEB STREAMING ---
def tqdm(iterable, *args, **kwargs):
    return iterable

geod = Geod(ellps="WGS84")

# CONFIGURATION
MAPBOX_API_KEY = os.getenv('MAPBOX_API_KEY')
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
MAP_STYLE = "mapbox://styles/mapbox/satellite-streets-v12"
VIDEO_FPS = 30
VIDEO_WIDTH = 1400
VIDEO_HEIGHT = 1050
ADAPTIVE_SAMPLING = True
TARGET_VIDEO_DURATION_MINUTES = 3
MIN_FRAMES_PER_SEGMENT = 1
MAX_FRAMES_PER_SEGMENT = 8
CAMERA_ZOOM_BASE = 17.0
CAMERA_ZOOM_MIN = 16.0
CAMERA_ZOOM_MAX = 18.0
CAMERA_PITCH_BASE = 60
CAMERA_PITCH_MIN = 50
CAMERA_PITCH_MAX = 70
DYNAMIC_CAMERA = True
TRAIL_WIDTH = 6
TRAIL_OPACITY = 0.9
TRAIL_LENGTH = 200
ENABLE_STOP_DETECTION = True
STOP_SPEED_THRESHOLD = 3.0
STOP_MIN_DURATION = 90
STOP_MIN_DISTANCE = 50
MAX_STOP_PHOTOS = 20
STOP_PHOTO_DISPLAY_DURATION = 3
USE_MAP_MATCHING = True
MAP_MATCHING_PROFILE = 'driving'
MAP_MATCHING_BATCH_SIZE = 100
MAP_MATCHING_RADIUS = 50
SMOOTH_WINDOW = 5
USE_GAUSSIAN_SMOOTHING = True
OUTPUT_VIDEO = os.path.join(VIDEOS_DIR, "relive_full_quality.mp4")
HTML_FILE = os.path.join(VIDEOS_DIR, "map_viewer_full.html")
BROWSER_TIMEOUT = 60
FRAME_WAIT = 0.12
ENCODING_CRF = 20
ENCODING_PRESET = 'medium'

# ============================================================================
# OPTIMIZED PROGRESS HELPER (Aggressive flushing)
# ============================================================================
def send_progress(step_name, percent, message="", stage="processing"):
    """
    CRITICAL: Triple flush to prevent browser timeout
    """
    data = {
        "step": step_name,
        "progress": percent,
        "message": message,
        "stage": stage,
        "timestamp": time.time()
    }
    
    # Print and flush 3 times for maximum reliability
    output = f"PROGRESS:{json.dumps(data)}"
    print(output, flush=True)
    sys.stdout.flush()
    sys.stderr.flush()  # Also flush stderr
    
    # Small sleep to ensure OS buffer flushes
    time.sleep(0.001)

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2
    c = 2 * math.asin(min(1.0, math.sqrt(a)))
    return R * c

def compute_bearing(lat1, lon1, lat2, lon2):
    dLon = math.radians(lon2 - lon1)
    y = math.sin(dLon) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - \
        math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dLon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def smooth_series(series, window=SMOOTH_WINDOW):
    if USE_GAUSSIAN_SMOOTHING:
        return pd.Series(gaussian_filter1d(series, sigma=window/2))
    return series.rolling(window=window, center=True, min_periods=1).mean()

def cubic_ease_in_out(t):
    if t < 0.5: return 4 * t * t * t
    return 1 - pow(-2 * t + 2, 3) / 2

def interpolate_bearing(bearing1, bearing2, t):
    diff = ((bearing2 - bearing1 + 180) % 360) - 180
    return (bearing1 + diff * t) % 360

def calculate_dynamic_camera(speed_kmh):
    if not DYNAMIC_CAMERA: return CAMERA_ZOOM_BASE, CAMERA_PITCH_BASE
    if speed_kmh < 20:
        t = speed_kmh / 20
        zoom = CAMERA_ZOOM_MAX - (CAMERA_ZOOM_MAX - CAMERA_ZOOM_BASE) * t * 0.5
        pitch = CAMERA_PITCH_MAX
    elif speed_kmh > 60:
        t = min((speed_kmh - 60) / 40, 1.0)
        zoom = CAMERA_ZOOM_BASE - (CAMERA_ZOOM_BASE - CAMERA_ZOOM_MIN) * t
        pitch = CAMERA_PITCH_BASE - (CAMERA_PITCH_BASE - CAMERA_PITCH_MIN) * t
    else:
        t = (speed_kmh - 20) / 40
        t_eased = cubic_ease_in_out(t)
        zoom = CAMERA_ZOOM_MAX - (CAMERA_ZOOM_MAX - CAMERA_ZOOM_MIN) * t_eased
        pitch = CAMERA_PITCH_MAX - (CAMERA_PITCH_MAX - CAMERA_PITCH_MIN) * t_eased
    return zoom, pitch

def format_time(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

# ============================================================================
# STOP DETECTION
# ============================================================================
def detect_stops(gps_df):
    send_progress("Stop Detection", 25, "Analyzing route for stops...")
    
    if 'Timestamp' not in gps_df.columns:
        timestamps = [datetime.now()]
        for i in range(1, len(gps_df)):
            if gps_df.loc[i, 'Speed'] > 1:
                dist_km = (gps_df.loc[i, 'Distance_km'] - gps_df.loc[i-1, 'Distance_km'])
                time_h = dist_km / max(gps_df.loc[i, 'Speed'], 1)
                timestamps.append(timestamps[-1] + timedelta(hours=time_h))
            else:
                timestamps.append(timestamps[-1] + timedelta(seconds=5))
        gps_df['Timestamp'] = timestamps
    
    gps_df['is_stop'] = gps_df['Speed'] <= STOP_SPEED_THRESHOLD
    gps_df['stop_group'] = (gps_df['is_stop'] != gps_df['is_stop'].shift()).cumsum()
    gps_df['time_diff'] = gps_df['Timestamp'].diff().dt.total_seconds().fillna(0)
    
    stop_durations = gps_df.groupby('stop_group').agg({'is_stop': 'first', 'time_diff': 'sum'}).reset_index()
    significant_stops = stop_durations[(stop_durations['is_stop'] == True) & (stop_durations['time_diff'] >= STOP_MIN_DURATION)]['stop_group'].tolist()
    
    stop_positions = []
    last_stop_lat, last_stop_lon = None, None
    
    for stop_group in significant_stops:
        stop_points = gps_df[gps_df['stop_group'] == stop_group]
        if len(stop_points) > 0:
            mid_idx = stop_points.index[len(stop_points) // 2]
            stop_lat = gps_df.loc[mid_idx, 'Latitude']
            stop_lon = gps_df.loc[mid_idx, 'Longitude']
            if last_stop_lat is not None:
                dist = haversine_distance(last_stop_lat, last_stop_lon, stop_lat, stop_lon)
                if dist < STOP_MIN_DISTANCE: continue
            stop_positions.append(mid_idx)
            last_stop_lat, last_stop_lon = stop_lat, stop_lon
            
    return stop_positions

# ============================================================================
# STREETVIEW PHOTO CAPTURE
# ============================================================================
def get_streetview_photo(lat, lon, heading=0, stop_id="stop"):
    try:
        if not GOOGLE_API_KEY: return None, False
        metadata_url = f"https://maps.googleapis.com/maps/api/streetview/metadata?location={lat},{lon}&key={GOOGLE_API_KEY}"
        if requests.get(metadata_url, timeout=5).json().get('status') == 'OK':
            photo_url = f"https://maps.googleapis.com/maps/api/streetview?size=600x400&location={lat},{lon}&heading={heading}&fov=90&pitch=10&key={GOOGLE_API_KEY}"
            response = requests.get(photo_url, timeout=10)
            if response.status_code == 200:
                img = Image.open(BytesIO(response.content)).convert("RGB")
                fname = f"{stop_id}_streetview.jpg"
                fpath = os.path.join(PHOTO_DIR, fname)
                img.save(fpath, quality=90)
                return fpath, True
    except: pass
    return None, False

def capture_stop_photos(gps_df, stop_positions):
    total_stops = min(len(stop_positions), MAX_STOP_PHOTOS)
    send_progress("Capturing Photos", 30, f"Preparing {total_stops} stop photos...")
    photo_data = {}
    
    for i, stop_idx in enumerate(stop_positions[:MAX_STOP_PHOTOS]):
        stop_row = gps_df.loc[stop_idx]
        
        # Send progress BEFORE API call
        pct = 30 + int((i / total_stops) * 10)
        send_progress("Capturing Photos", pct, f"Capturing stop {i+1}/{total_stops}")
        sys.stdout.flush()
        
        fpath, success = get_streetview_photo(
            stop_row['Latitude'], 
            stop_row['Longitude'], 
            heading=stop_row.get('Bearing', 0), 
            stop_id=f"stop_{i+1}"
        )
        
        if success:
            with open(fpath, "rb") as f:
                img_base64 = base64.b64encode(f.read()).decode("utf-8")
            photo_data[stop_idx] = {
                'photo': f"data:image/jpeg;base64,{img_base64}",
                'lat': stop_row['Latitude'],
                'lon': stop_row['Longitude'],
                'stop_num': i + 1
            }

    return photo_data

# ============================================================================
# MAP MATCHING
# ============================================================================
def mapbox_map_matching(coordinates):
    if len(coordinates) > 100 or not MAPBOX_API_KEY: return coordinates
    coords_str = ';'.join([f"{lon},{lat}" for lon, lat in coordinates])
    url = f"https://api.mapbox.com/matching/v5/mapbox/{MAP_MATCHING_PROFILE}/{coords_str}"
    params = {'access_token': MAPBOX_API_KEY, 'geometries': 'geojson', 'overview': 'full', 'tidy': 'true'}
    try:
        resp = requests.get(url, params=params, timeout=15).json()
        if 'matchings' in resp: return resp['matchings'][0]['geometry']['coordinates']
    except: pass
    return coordinates

# ============================================================================
# GPS DATA PROCESSING (OPTIMIZED)
# ============================================================================
def process_gps_data(gps_df):
    send_progress("Loading Data", 5, "Processing GPS coordinates...")
    
    # 1. Speed calculation
    if 'Speed' not in gps_df.columns:
        gps_df['Speed'] = 0.0
    else:
        gps_df['Speed'] = gps_df['Speed'].astype(float)

    if gps_df['Speed'].max() == 0:
        for i in range(1, len(gps_df)):
            dist = haversine_distance(
                gps_df.loc[i-1, 'Latitude'], gps_df.loc[i-1, 'Longitude'],
                gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude']
            )
            gps_df.loc[i, 'Speed'] = float((dist/5.0 * 3.6) if dist < 500 else 0.0)

    gps_df['Speed'] = smooth_series(gps_df['Speed'])
    send_progress("Loading Data", 10, "Speed calculation complete")
    
    # 2. Map Matching (HYPER-OPTIMIZED with micro-updates)
    if USE_MAP_MATCHING and MAPBOX_API_KEY:
        send_progress("Map Matching", 15, "Aligning route to roads...")
        all_matched = []
        
        # ULTRA-SMALL BATCHES for constant stream
        batch_size = 20  # Reduced from 30
        batches = [gps_df.iloc[i:i+batch_size] for i in range(0, len(gps_df), batch_size)]
        
        for i, batch in enumerate(batches):
            coords = [[row['Longitude'], row['Latitude']] for _, row in batch.iterrows()]
            
            # CRITICAL: Update BEFORE and AFTER each API call
            pct = 15 + int((i / len(batches)) * 10)
            send_progress("Map Matching", pct, f"Batch {i+1}/{len(batches)} - requesting...")
            
            matched = mapbox_map_matching(coords)
            all_matched.extend(matched)
            
            # Immediate confirmation after API returns
            send_progress("Map Matching", pct, f"Batch {i+1}/{len(batches)} - received ✓")

        send_progress("Map Matching", 25, "Route alignment complete")

    # 3. Bearings & Distance
    send_progress("Map Matching", 26, "Calculating bearings...")
    bearings, distances, times = [], [0.0], [0.0]
    for i in range(len(gps_df) - 1):
        bearings.append(compute_bearing(
            gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude'],
            gps_df.loc[i+1, 'Latitude'], gps_df.loc[i+1, 'Longitude']
        ))
        dist = haversine_distance(
            gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude'],
            gps_df.loc[i+1, 'Latitude'], gps_df.loc[i+1, 'Longitude']
        )
        distances.append(distances[-1] + dist)
        
    bearings.append(bearings[-1] if bearings else 0)
    gps_df['Bearing'] = smooth_series(pd.Series(bearings))
    gps_df['Distance_km'] = [d / 1000.0 for d in distances]
    
    send_progress("Map Matching", 28, "Calculating timestamps...")
    
    # 4. Time calculation
    for i in range(1, len(gps_df)):
        speed_val = gps_df.loc[i, 'Speed']
        if speed_val > 1:
            time_s = ((distances[i] - distances[i-1]) / (speed_val / 3.6))
            times.append(times[-1] + time_s)
        else:
            times.append(times[-1] + 2)
    gps_df['Time_seconds'] = times
    
    send_progress("Map Matching", 30, "GPS processing complete")
    
    return gps_df

# ============================================================================
# FRAME GENERATION
# ============================================================================
def generate_adaptive_frames(gps_df):
    send_progress("Frame Generation", 40, "Calculating camera path...")
    
    target_frames = int(TARGET_VIDEO_DURATION_MINUTES * 60 * VIDEO_FPS)
    positions = []
    
    # Linear interpolation for simplicity
    for i in range(len(gps_df) - 1):
        row1, row2 = gps_df.iloc[i], gps_df.iloc[i+1]
        steps = max(1, int((row2['Distance_km'] - row1['Distance_km']) * 1000 / 5))
        
        for t in np.linspace(0, 1, steps, endpoint=False):
            lat = row1['Latitude'] + (row2['Latitude'] - row1['Latitude']) * t
            lon = row1['Longitude'] + (row2['Longitude'] - row1['Longitude']) * t
            bearing = interpolate_bearing(row1['Bearing'], row2['Bearing'], t)
            
            positions.append({
                'lat': lat, 'lon': lon, 'bearing': bearing,
                'speed': row1['Speed'], 'zoom': 17, 'pitch': 60,
                'distance_km': row1['Distance_km'], 
                'time_seconds': row1['Time_seconds'],
                'idx': i
            })

    # Resample to target fps
    if len(positions) > target_frames:
        indices = np.linspace(0, len(positions)-1, target_frames).astype(int)
        positions = [positions[i] for i in indices]

    send_progress("Frame Generation", 50, f"Generated {len(positions)} frames")
    return positions

# ============================================================================
# VIDEO RENDERING (OPTIMIZED PROGRESS)
# ============================================================================
def render_video_static_fallback(camera_positions, gps_df, photo_data, output_path):
    send_progress("Rendering video", 55, "Starting rendering engine...")
    
    frames = []
    last_frame = None
    
    try:
        font_huge = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 70)
        font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
    except:
        font_huge = font_large = ImageFont.load_default()

    total_frames = len(camera_positions)
    
    # CRITICAL: Update EVERY 5 frames minimum (constant heartbeat)
    update_interval = 5
    
    for i, pos in enumerate(camera_positions):
        # HYPER-FREQUENT UPDATES
        if i % update_interval == 0 or i == total_frames - 1:
            pct = 55 + int((i / total_frames) * 35)
            send_progress("Rendering video", pct, f"Frame {i}/{total_frames}")
        
        # HEARTBEAT: Even between updates, send a keep-alive
        elif i % 2 == 0:
            # Silent heartbeat (no progress change, just connection keep-alive)
            print(f"PROGRESS:{json.dumps({'message': 'rendering...', 'stage': 'processing'})}", flush=True)

        try:
            should_download = (i == 0) or (i % 3 == 0)
            
            if should_download and MAPBOX_API_KEY:
                url = f"https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/{pos['lon']},{pos['lat']},{pos['zoom']},{int(pos['bearing'])},{int(pos['pitch'])}/800x600@2x?access_token={MAPBOX_API_KEY}"
                resp = requests.get(url, timeout=5)
                if resp.status_code == 200:
                    last_frame = Image.open(BytesIO(resp.content)).resize((VIDEO_WIDTH, VIDEO_HEIGHT))
            
            if last_frame:
                img = last_frame.copy()
            else:
                img = Image.new('RGB', (VIDEO_WIDTH, VIDEO_HEIGHT), (20, 20, 20))

            draw = ImageDraw.Draw(img)
            draw.text((50, 50), f"{int(pos['speed'])} km/h", fill=(0, 255, 136), font=font_huge)
            draw.text((50, 150), f"{pos['distance_km']:.1f} km", fill=(255, 255, 255), font=font_large)
            
            frames.append(np.array(img))
            
        except Exception:
            if frames: 
                frames.append(frames[-1])

    send_progress("Rendering video", 90, "Encoding video file...")
    
    imageio.mimsave(
        output_path, frames, fps=VIDEO_FPS, 
        codec='libx264', pixelformat='yuv420p',
        output_params=['-crf', str(ENCODING_CRF), '-preset', 'ultrafast']
    )
    
    send_progress("Completed", 100, "Video generation successful!", stage="success")

# ============================================================================
# MAIN FUNCTION
# ============================================================================
def main(gps_file, uploads_dir=None):
    global UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR, OUTPUT_VIDEO
    
    if uploads_dir:
        UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR = setup_environment(uploads_dir)
        OUTPUT_VIDEO = os.path.join(VIDEOS_DIR, "relive_full_quality.mp4")

    try:
        # Load GPS data
        df = pd.read_excel(gps_file)
        col_map = {c.lower(): c for c in df.columns}
        
        lat_col = next((c for c in col_map if 'lat' in c), None)
        lon_col = next((c for c in col_map if 'lon' in c or 'lng' in c), None)
        
        if not lat_col or not lon_col:
            raise ValueError("Could not find latitude/longitude columns in data")
        
        gps_df = pd.DataFrame({
            'Latitude': df[col_map[lat_col]], 
            'Longitude': df[col_map[lon_col]]
        })
        gps_df = gps_df.dropna()
        
        # Process data
        gps_df = process_gps_data(gps_df)
        
        # Detect stops
        stops = detect_stops(gps_df) if ENABLE_STOP_DETECTION else []
        photo_data = capture_stop_photos(gps_df, stops) if stops else {}
        
        # Generate frames
        positions = generate_adaptive_frames(gps_df)
        
        # Render video
        render_video_static_fallback(positions, gps_df, photo_data, OUTPUT_VIDEO)
        
        return OUTPUT_VIDEO
        
    except Exception as e:
        # Ensure error is sent before crash
        send_progress("Error", 0, str(e), stage="error")
        sys.stdout.flush()
        raise e

if __name__ == '__main__':
    if len(sys.argv) > 1:
        main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)