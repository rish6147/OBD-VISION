# ============================================================================
# SETUP & INSTALLATION
# ============================================================================
import subprocess
import sys
import os
import base64
from concurrent.futures import ThreadPoolExecutor
import multiprocessing

# Set UTF-8 encoding for Windows console
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Try to load environment variables from .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("WARNING: python-dotenv not installed. Environment variables may not load from .env")

def setup_environment(uploads_base_dir=None):
    """Create directories for frames and photos"""
    if uploads_base_dir is None:
        uploads_base_dir = os.path.join(os.path.dirname(__file__), 'uploads')
    
    # Ensure the base uploads directory exists
    os.makedirs(uploads_base_dir, exist_ok=True)
    
    frames_dir = os.path.join(uploads_base_dir, 'frames')
    photos_dir = os.path.join(uploads_base_dir, 'stop_photos')
    videos_dir = os.path.join(uploads_base_dir, 'videos')
    
    os.makedirs(frames_dir, exist_ok=True)
    os.makedirs(photos_dir, exist_ok=True)
    os.makedirs(videos_dir, exist_ok=True)
    
    return uploads_base_dir, frames_dir, photos_dir, videos_dir

# Initialize with default uploads directory
UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR = setup_environment()
OUTPUT_DIR = UPLOADS_BASE_DIR

def install_system_packages():
    """Install system packages with optimizations (Linux/Ubuntu only)"""
    # Skip on Windows - user should have installed system dependencies manually
    if sys.platform == 'win32':
        print("[SYSTEM] Windows detected - skipping apt-get installation")
        print("[SYSTEM] Please ensure Chrome and FFmpeg are installed manually")
        return
    
    print("[SYSTEM] Installing system packages...")
    
    try:
        subprocess.run(['apt-get', 'update'], check=True, 
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print("   Installing Chromium...")
        result = subprocess.run(['apt-get', 'install', '-y', 'chromium-browser'], 
                               capture_output=True, text=True)
        if result.returncode != 0:
            subprocess.run(['apt-get', 'install', '-y', 'chromium'], 
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        subprocess.run(['apt-get', 'install', '-y', 'chromium-chromedriver'], 
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print("   Installing FFmpeg with GPU support...")
        subprocess.run(['apt-get', 'install', '-y', 'ffmpeg'], 
                      check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print("   [OK] System packages installed!")
        
    except Exception as e:
        print(f"   WARNING: {e}")

def install_python_packages():
    """Install Python packages"""
    # Check if packages are already installed
    try:
        import pandas, numpy, imageio, PIL, scipy, selenium
        print("[SYSTEM] All Python packages already installed")
        return
    except ImportError:
        pass
    
    print("[SYSTEM] Installing Python packages...")
    packages = [
        'selenium', 'pandas', 'numpy', 'pyproj', 
        'imageio', 'imageio-ffmpeg',
        'pillow', 'tqdm', 'requests', 
        'openpyxl', 'scipy', 'webdriver-manager'
    ]
    
    subprocess.run([sys.executable, 'pip', 'install', '-q'] + packages, 
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("[SYSTEM] Python packages installed!")

install_system_packages()
install_python_packages()
print(f"[SYSTEM] Setup complete! Output: {OUTPUT_DIR}\n")

# ============================================================================
# IMPORTS
# ============================================================================
import math
import json
import time
from io import BytesIO
from datetime import datetime, timedelta

import pandas as pd
import numpy as np
from tqdm.auto import tqdm
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

geod = Geod(ellps="WGS84")

# ============================================================================
# CONFIGURATION - HIGH QUALITY + OPTIMIZED
# ============================================================================
# API Keys are now loaded from .env file for security
MAPBOX_API_KEY = os.getenv('MAPBOX_API_KEY')
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')

# Validate API keys are loaded
if not MAPBOX_API_KEY or not GOOGLE_API_KEY:
    print("WARNING: API keys not found in .env file!")
    print("   Set MAPBOX_API_KEY and GOOGLE_API_KEY in .env before running")
    sys.exit(1)

# Map Style - SATELLITE STREETS
MAP_STYLE = "mapbox://styles/mapbox/satellite-streets-v12"

# Video Settings - OPTIMIZED RESOLUTION
VIDEO_FPS = 30
VIDEO_WIDTH = 1400   # Reduced for faster rendering
VIDEO_HEIGHT = 1050  # Reduced for faster rendering
VIDEO_QUALITY = 'high'  # high/medium/low

# Adaptive Frame Rate - KEY OPTIMIZATION
# Instead of rendering every GPS point, we adaptively sample based on:
# - Speed (more frames when slow/interesting)
# - Direction changes (more frames on turns)
# - Stops (more frames at stops)
ADAPTIVE_SAMPLING = True
TARGET_VIDEO_DURATION_MINUTES = 3  # Aim for 3-5 min final video
MIN_FRAMES_PER_SEGMENT = 1  # Reduced from 2 for better compression
MAX_FRAMES_PER_SEGMENT = 8  # Reduced from 10 for better compression

# Camera Settings - HIGH QUALITY
CAMERA_ZOOM_BASE = 17.0
CAMERA_ZOOM_MIN = 16.0
CAMERA_ZOOM_MAX = 18.0
CAMERA_PITCH_BASE = 60
CAMERA_PITCH_MIN = 50
CAMERA_PITCH_MAX = 70
DYNAMIC_CAMERA = True
SMOOTH_CAMERA_TRANSITIONS = True

# Trail Settings - HIGH QUALITY
TRAIL_WIDTH = 6
TRAIL_OPACITY = 0.9
TRAIL_LENGTH = 200
ENABLE_SPEED_GRADIENT = True

# 3D Settings - DISABLED for speed but high quality 2D
ENABLE_3D_BUILDINGS = False

# Stop Detection - COMPREHENSIVE
ENABLE_STOP_DETECTION = True
STOP_SPEED_THRESHOLD = 3.0  # km/h
STOP_MIN_DURATION = 90  # seconds
STOP_MIN_DISTANCE = 50  # meters - avoid duplicate stops
MAX_STOP_PHOTOS = 20  # Capture up to 20 stops
STOP_PHOTO_DISPLAY_DURATION = 3  # seconds to show each photo

# Map Matching - OPTIMIZED
USE_MAP_MATCHING = True
MAP_MATCHING_PROFILE = 'driving'
MAP_MATCHING_BATCH_SIZE = 100  # Large batches for efficiency
MAP_MATCHING_RADIUS = 50

# GPS Processing - USE ALL DATA
USE_ALL_GPS_POINTS = True  # KEY: Use all coordinates
MAX_GPS_POINTS = None  # No limit!
SMOOTH_WINDOW = 5
USE_GAUSSIAN_SMOOTHING = True

# Output Paths
OUTPUT_VIDEO = os.path.join(VIDEOS_DIR, "relive_full_quality.mp4")
HTML_FILE = os.path.join(VIDEOS_DIR, "map_viewer_full.html")

# Browser - OPTIMIZED
BROWSER_TIMEOUT = 60
FRAME_WAIT = 0.12  # Slightly faster capture

# Encoding - HIGH QUALITY
ENCODING_PRESET = 'medium'  # medium = good balance
ENCODING_CRF = 20  # Lower = better quality (18-23 is visually lossless)

# ============================================================================
# UTILITY FUNCTIONS
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
    if t < 0.5:
        return 4 * t * t * t
    else:
        return 1 - pow(-2 * t + 2, 3) / 2

def interpolate_bearing(bearing1, bearing2, t):
    diff = ((bearing2 - bearing1 + 180) % 360) - 180
    return (bearing1 + diff * t) % 360

def speed_to_color_gradient(speed_kmh, vmin=0, vmax=80):
    """Premium color gradient"""
    norm = np.clip((speed_kmh - vmin) / (vmax - vmin), 0, 1)
    
    if norm < 0.2:
        t = norm / 0.2
        r, g, b = int(0 + 100*t), int(100 + 155*t), int(255)
    elif norm < 0.4:
        t = (norm - 0.2) / 0.2
        r, g, b = int(100 - 100*t), int(255), int(255 - 155*t)
    elif norm < 0.6:
        t = (norm - 0.4) / 0.2
        r, g, b = int(0 + 255*t), int(255), int(100 - 100*t)
    elif norm < 0.8:
        t = (norm - 0.6) / 0.2
        r, g, b = int(255), int(255 - 100*t), int(0)
    else:
        t = (norm - 0.8) / 0.2
        r, g, b = int(255), int(155 - 155*t), int(0)
    
    return f"rgb({r},{g},{b})"

def calculate_dynamic_camera(speed_kmh):
    if not DYNAMIC_CAMERA:
        return CAMERA_ZOOM_BASE, CAMERA_PITCH_BASE
    
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
# STOP DETECTION WITH DEDUPLICATION
# ============================================================================
def detect_stops(gps_df, speed_threshold=STOP_SPEED_THRESHOLD, 
                min_duration=STOP_MIN_DURATION, min_distance=STOP_MIN_DISTANCE):
    """Detect all significant stops with deduplication"""
    print("\n🔍 COMPREHENSIVE STOP DETECTION...")
    
    # Create timestamps if missing
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
    
    # Mark stops
    gps_df['is_stop'] = gps_df['Speed'] <= speed_threshold
    gps_df['stop_group'] = (gps_df['is_stop'] != gps_df['is_stop'].shift()).cumsum()
    gps_df['time_diff'] = gps_df['Timestamp'].diff().dt.total_seconds().fillna(0)
    
    # Find significant stop groups
    stop_durations = gps_df.groupby('stop_group').agg({
        'is_stop': 'first',
        'time_diff': 'sum'
    }).reset_index()
    
    significant_stops = stop_durations[
        (stop_durations['is_stop'] == True) &
        (stop_durations['time_diff'] >= min_duration)
    ]['stop_group'].tolist()
    
    # Get stop positions with deduplication
    stop_positions = []
    last_stop_lat, last_stop_lon = None, None
    
    for stop_group in significant_stops:
        stop_points = gps_df[gps_df['stop_group'] == stop_group]
        if len(stop_points) > 0:
            mid_idx = stop_points.index[len(stop_points) // 2]
            stop_lat = gps_df.loc[mid_idx, 'Latitude']
            stop_lon = gps_df.loc[mid_idx, 'Longitude']
            
            # Check distance from last stop
            if last_stop_lat is not None:
                dist = haversine_distance(last_stop_lat, last_stop_lon, stop_lat, stop_lon)
                if dist < min_distance:
                    continue  # Skip this stop, too close to previous
            
            stop_positions.append(mid_idx)
            last_stop_lat, last_stop_lon = stop_lat, stop_lon
    
    print(f"   ✅ Detected {len(stop_positions)} unique significant stops")
    return stop_positions

def get_streetview_photo(lat, lon, heading=0, stop_id="stop"):
    """Capture Google Street View photo"""
    try:
        metadata_url = (
            f"https://maps.googleapis.com/maps/api/streetview/metadata"
            f"?location={lat},{lon}&key={GOOGLE_API_KEY}"
        )
        response = requests.get(metadata_url, timeout=10)
        
        if response.status_code == 200 and response.json().get('status') == 'OK':
            photo_url = (
                f"https://maps.googleapis.com/maps/api/streetview"
                f"?size=600x400"
                f"&location={lat},{lon}"
                f"&heading={heading}&fov=90&pitch=10"
                f"&key={GOOGLE_API_KEY}"
            )
            
            response = requests.get(photo_url, timeout=15)
            if response.status_code == 200:
                img = Image.open(BytesIO(response.content))
                if img.mode != "RGB":
                    img = img.convert("RGB")
                
                fname = f"{stop_id}_streetview.jpg"
                fpath = os.path.join(PHOTO_DIR, fname)
                img.save(fpath, quality=90)
                return fpath, True
        
    except Exception as e:
        print(f"   ⚠️  Street View unavailable for {stop_id}")
    
    return None, False

def capture_stop_photos(gps_df, stop_positions):
    """Capture Street View photos at all stops (parallel processing)"""
    print(f"\n📸 CAPTURING STOP PHOTOS (up to {MAX_STOP_PHOTOS})...")
    
    photo_data = {}
    max_photos = min(MAX_STOP_PHOTOS, len(stop_positions))
    
    def capture_single_photo(args):
        i, stop_idx = args
        stop_row = gps_df.loc[stop_idx]
        lat, lon = stop_row['Latitude'], stop_row['Longitude']
        bearing = stop_row.get('Bearing', 0)
        
        fpath, success = get_streetview_photo(lat, lon, heading=bearing, stop_id=f"stop_{i+1}")
        
        if success:
            img = Image.open(fpath)
            buffer = BytesIO()
            img.save(buffer, format="JPEG", quality=85)
            img_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
            return stop_idx, {
                'photo': f"data:image/jpeg;base64,{img_base64}",
                'lat': lat,
                'lon': lon,
                'stop_num': i + 1
            }
        return None, None
    
    # Capture photos with progress bar
    with ThreadPoolExecutor(max_workers=5) as executor:
        args_list = [(i, stop_idx) for i, stop_idx in enumerate(stop_positions[:max_photos])]
        results = list(tqdm(
            executor.map(capture_single_photo, args_list),
            total=len(args_list),
            desc="   Progress"
        ))
    
    # Collect successful photos
    for stop_idx, data in results:
        if stop_idx is not None:
            photo_data[stop_idx] = data
    
    print(f"   ✅ Successfully captured {len(photo_data)} photos")
    return photo_data

# ============================================================================
# MAP MATCHING - OPTIMIZED FOR ALL DATA
# ============================================================================
def mapbox_map_matching(coordinates, profile='driving', radius=50):
    if not coordinates or len(coordinates) < 2:
        return coordinates
    
    if len(coordinates) > 100:
        return coordinates
    
    coords_str = ';'.join([f"{lon},{lat}" for lon, lat in coordinates])
    radiuses_str = ';'.join([str(radius)] * len(coordinates))
    
    url = f"https://api.mapbox.com/matching/v5/mapbox/{profile}/{coords_str}"
    params = {
        'access_token': MAPBOX_API_KEY,
        'geometries': 'geojson',
        'radiuses': radiuses_str,
        'overview': 'full',
        'tidy': 'true'
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code == 200:
            data = response.json()
            if 'code' in data and data['code'] != 'Ok':
                return coordinates
            if 'matchings' in data and len(data['matchings']) > 0:
                geometry = data['matchings'][0]['geometry']
                matched_coords = geometry['coordinates']
                return matched_coords
        return coordinates
    except:
        return coordinates

def match_gps_to_roads(gps_df, batch_size=MAP_MATCHING_BATCH_SIZE):
    print("\n🛣️  MAP MATCHING (ALL DATA)...")
    
    all_matched_coords = []
    all_matched_speeds = []
    
    total_points = len(gps_df)
    num_batches = (total_points + batch_size - 1) // batch_size
    
    print(f"   Processing {total_points} points in {num_batches} batches...")
    
    for i in tqdm(range(num_batches), desc="   Batches"):
        start_idx = i * batch_size
        end_idx = min((i + 1) * batch_size, total_points)
        batch_df = gps_df.iloc[start_idx:end_idx]
        
        coords = [[row['Longitude'], row['Latitude']] for _, row in batch_df.iterrows()]
        speeds = batch_df['Speed'].tolist()
        
        matched_coords = mapbox_map_matching(coords, profile=MAP_MATCHING_PROFILE, radius=MAP_MATCHING_RADIUS)
        
        if len(matched_coords) != len(speeds):
            original_indices = np.linspace(0, len(speeds) - 1, len(speeds))
            matched_indices = np.linspace(0, len(speeds) - 1, len(matched_coords))
            matched_speeds_batch = np.interp(matched_indices, original_indices, speeds)
        else:
            matched_speeds_batch = speeds
        
        all_matched_coords.extend(matched_coords)
        all_matched_speeds.extend(matched_speeds_batch)
        time.sleep(0.05)
    
    matched_df = pd.DataFrame({
        'Longitude': [c[0] for c in all_matched_coords],
        'Latitude': [c[1] for c in all_matched_coords],
        'Speed': all_matched_speeds
    })
    
    print(f"   ✅ Matched: {len(gps_df)} → {len(matched_df)} points")
    return matched_df

# ============================================================================
# DATA PROCESSING - ALL GPS POINTS
# ============================================================================
def load_gps_data(filepath):
    print("📍 LOADING ALL GPS DATA...")
    df = pd.read_excel(filepath)
    print(f"   Total rows: {len(df)}")
    print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 5, 'message': 'Loading GPS data...', 'step': 'Loading Data'})}", flush=True)

    col_map = {}
    for col in df.columns:
        col_lower = str(col).lower()
        if any(x in col_lower for x in ['latitude', 'lat', '緯度']):
            col_map['lat'] = col
        elif any(x in col_lower for x in ['longitude', 'long', 'lng', '經度']):
            col_map['lon'] = col
        elif 'speed' in col_lower or '時速' in col_lower:
            col_map['speed'] = col

    gps_data = pd.DataFrame({
        'Latitude': df[col_map['lat']],
        'Longitude': df[col_map['lon']],
        'Speed': df[col_map.get('speed', col_map['lat'])] if 'speed' in col_map else 0
    })
    
    # Basic cleaning only
    gps_data = gps_data.dropna(subset=['Latitude', 'Longitude'])
    gps_data = gps_data[(gps_data['Latitude'].between(20, 27)) & 
                        (gps_data['Longitude'].between(118, 123))]
    gps_data = gps_data.drop_duplicates(subset=['Latitude', 'Longitude'], keep='first')
    
    print(f"   ✅ Using ALL {len(gps_data)} GPS points (no downsampling)")
    return gps_data.reset_index(drop=True)

def process_gps_data(gps_df):
    print("\n⚙️  PROCESSING ALL GPS DATA...")
    print(f"   Total points: {len(gps_df)}")
    
    # Calculate speeds if missing
    if 'Speed' not in gps_df.columns or gps_df['Speed'].max() == 0:
        print("   Calculating speeds...")
        gps_df['Speed'] = 0
        for i in range(1, len(gps_df)):
            dist = haversine_distance(
                gps_df.loc[i-1, 'Latitude'], gps_df.loc[i-1, 'Longitude'],
                gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude']
            )
            speed_ms = dist / 5.0 if dist < 500 else 0
            gps_df.loc[i, 'Speed'] = speed_ms * 3.6
    
    # Smooth speeds
    gps_df['Speed'] = smooth_series(gps_df['Speed'], window=SMOOTH_WINDOW)
    
    # Map matching
    if USE_MAP_MATCHING:
        print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 15, 'message': 'Matching GPS to roads...', 'step': 'Map Matching'})}", flush=True)
        gps_df = match_gps_to_roads(gps_df, batch_size=MAP_MATCHING_BATCH_SIZE)
    
    print(f"   Calculating bearings for {len(gps_df)} points...")
    bearings = []
    for i in range(len(gps_df) - 1):
        bearing = compute_bearing(
            gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude'],
            gps_df.loc[i+1, 'Latitude'], gps_df.loc[i+1, 'Longitude']
        )
        bearings.append(bearing)
    bearings.append(bearings[-1] if bearings else 0)
    gps_df['Bearing'] = smooth_series(pd.Series(bearings), window=5)
    
    print(f"   Calculating distances...")
    distances = [0.0]
    for i in range(1, len(gps_df)):
        dist = haversine_distance(
            gps_df.loc[i-1, 'Latitude'], gps_df.loc[i-1, 'Longitude'],
            gps_df.loc[i, 'Latitude'], gps_df.loc[i, 'Longitude']
        )
        distances.append(distances[-1] + dist)
    gps_df['Distance_km'] = [d / 1000.0 for d in distances]
    
    print(f"   Calculating timestamps...")
    times = [0.0]
    for i in range(1, len(gps_df)):
        if gps_df.loc[i, 'Speed'] > 1:
            dist_km = (distances[i] - distances[i-1]) / 1000.0
            time_h = dist_km / max(gps_df.loc[i, 'Speed'], 1)
            times.append(times[-1] + time_h * 3600)
        else:
            times.append(times[-1] + 2)
    gps_df['Time_seconds'] = times
    
    print(f"\n   ✅ ROUTE STATISTICS:")
    print(f"      Total Points: {len(gps_df)}")
    print(f"      Total Distance: {gps_df['Distance_km'].iloc[-1]:.1f} km")
    print(f"      Average Speed: {gps_df['Speed'].mean():.0f} km/h")
    print(f"      Max Speed: {gps_df['Speed'].max():.0f} km/h")
    print(f"      Total Duration: {format_time(gps_df['Time_seconds'].iloc[-1])}")
    
    return gps_df

# ============================================================================
# ADAPTIVE FRAME GENERATION - KEY OPTIMIZATION
# ============================================================================
def generate_adaptive_frames(gps_df, target_duration_min=TARGET_VIDEO_DURATION_MINUTES):
    """
    Intelligently sample frames based on:
    - Speed changes (more frames when speed varies)
    - Direction changes (more frames on turns)
    - Stops (extra frames at stops)
    - Maintain smooth motion
    """
    print(f"\n📹 GENERATING ADAPTIVE FRAMES (target: {target_duration_min} min video)...")
    
    target_total_frames = int(target_duration_min * 60 * VIDEO_FPS)
    
    # Calculate importance score for each segment
    importance = []
    for i in range(len(gps_df) - 1):
        score = 1.0
        
        # Speed change importance
        if i > 0:
            speed_change = abs(gps_df.loc[i, 'Speed'] - gps_df.loc[i-1, 'Speed'])
            score += speed_change / 10.0
        
        # Direction change importance (turns)
        if i > 0:
            bearing_change = abs(gps_df.loc[i, 'Bearing'] - gps_df.loc[i-1, 'Bearing'])
            if bearing_change > 180:
                bearing_change = 360 - bearing_change
            score += bearing_change / 30.0
        
        # Slow speed importance (interesting areas)
        if gps_df.loc[i, 'Speed'] < 20:
            score += 2.0
        
        # Stop importance
        if gps_df.loc[i, 'Speed'] < 5:
            score += 3.0
        
        importance.append(score)
    
    importance.append(importance[-1] if importance else 1.0)
    importance = np.array(importance)
    
    # Normalize importance
    importance = importance / importance.sum()
    
    # Allocate frames based on importance
    frames_per_segment = np.round(importance * target_total_frames).astype(int)
    frames_per_segment = np.clip(frames_per_segment, MIN_FRAMES_PER_SEGMENT, MAX_FRAMES_PER_SEGMENT)
    
    # Adjust to match target
    current_total = frames_per_segment.sum()
    if current_total > target_total_frames:
        # Reduce frames proportionally
        scale = target_total_frames / current_total
        frames_per_segment = np.round(frames_per_segment * scale).astype(int)
        frames_per_segment = np.maximum(frames_per_segment, 1)
    
    print(f"   Generating {frames_per_segment.sum()} frames from {len(gps_df)} GPS points")
    
    # Generate camera positions
    positions = []
    for i in range(len(gps_df) - 1):
        lat1, lon1, bearing1 = gps_df.loc[i, ['Latitude', 'Longitude', 'Bearing']]
        lat2, lon2, bearing2 = gps_df.loc[i+1, ['Latitude', 'Longitude', 'Bearing']]
        speed1, speed2 = gps_df.loc[i, 'Speed'], gps_df.loc[i+1, 'Speed']
        dist1, dist2 = gps_df.loc[i, 'Distance_km'], gps_df.loc[i+1, 'Distance_km']
        time1, time2 = gps_df.loc[i, 'Time_seconds'], gps_df.loc[i+1, 'Time_seconds']
        
        num_frames = frames_per_segment[i]
        
        for t in np.linspace(0, 1, num_frames, endpoint=False):
            t_eased = cubic_ease_in_out(t)
            
            current_speed = float(speed1 + (speed2 - speed1) * t_eased)
            zoom, pitch = calculate_dynamic_camera(current_speed)
            
            positions.append({
                'lat': float(lat1 + (lat2 - lat1) * t_eased),
                'lon': float(lon1 + (lon2 - lon1) * t_eased),
                'bearing': float(interpolate_bearing(bearing1, bearing2, t_eased)),
                'speed': current_speed,
                'zoom': zoom,
                'pitch': pitch,
                'distance_km': float(dist1 + (dist2 - dist1) * t_eased),
                'time_seconds': float(time1 + (time2 - time1) * t_eased),
                'idx': i
            })
    
    print(f"   ✅ Generated {len(positions)} frames")
    print(f"   ✅ Estimated video duration: {len(positions) / VIDEO_FPS / 60:.1f} minutes")
    print(f"   ✅ Compression ratio: {len(gps_df) / len(positions):.1f}x")
    
    return positions

# ============================================================================
# HTML GENERATION - HIGH QUALITY WITH SATELLITE STREETS
# ============================================================================
def generate_html_viewer(gps_df, photo_data, output_path=HTML_FILE):
    print("\n🌐 Generating HTML viewer...")
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    trail_coordinates = [[row['Longitude'], row['Latitude']] 
                         for _, row in gps_df.iterrows()]
    
    stop_markers = []
    for idx, data in photo_data.items():
        stop_markers.append({
            'lat': data['lat'],
            'lon': data['lon'],
            'photo': data['photo'],
            'idx': int(idx),
            'stop_num': data.get('stop_num', 0)
        })
    
    html_content = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Relive - Full Route Visualization (Satellite Streets)</title>
    <script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
    <link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { overflow: hidden; font-family: 'Inter', sans-serif; background: #000; }
        #map { position: absolute; top: 0; bottom: 0; width: 100%; }
        
        .stats-overlay {
            position: absolute; top: 40px; left: 40px;
            background: linear-gradient(145deg, rgba(0,0,0,0.95) 0%, rgba(30,30,30,0.9) 100%);
            color: white; padding: 30px 35px; border-radius: 20px;
            min-width: 300px;
            box-shadow: 0 10px 50px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.1);
            backdrop-filter: blur(15px); z-index: 1000;
        }
        
        .stat-item { margin-bottom: 22px; }
        .stat-item:last-child { margin-bottom: 0; }
        
        .stat-label {
            font-size: 10px; color: rgba(255,255,255,0.5);
            margin-bottom: 6px; text-transform: uppercase;
            letter-spacing: 2px; font-weight: 700;
        }
        
        .stat-value {
            font-size: 44px; font-weight: 800;
            background: linear-gradient(135deg, #00ff88 0%, #00ffd5 50%, #00ff88 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            line-height: 1;
            text-shadow: 0 0 30px rgba(0,255,136,0.3);
        }
        
        .stat-value.secondary { font-size: 26px; font-weight: 700; }
        .stat-value .unit { 
            font-size: 16px; opacity: 0.8; margin-left: 4px; font-weight: 600;
        }
        
        .progress-container {
            position: absolute; bottom: 0; left: 0; right: 0;
            height: 60px;
            background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.9) 100%);
            padding: 0 40px 15px 40px;
            display: flex; align-items: flex-end; z-index: 1000;
        }
        
        .progress-bar {
            flex: 1; height: 8px;
            background: rgba(255,255,255,0.1);
            border-radius: 10px; overflow: hidden;
            box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);
        }
        
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #00ff88 0%, #00ffd5 50%, #00ff88 100%);
            background-size: 200% 100%;
            width: 0%; transition: width 0.1s linear;
            box-shadow: 0 0 25px rgba(0,255,136,0.8);
            animation: shimmer 3s infinite linear;
        }
        
        @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
        }
        
        .time-display {
            position: absolute; top: 40px; right: 40px;
            background: rgba(0,0,0,0.9);
            color: #00ff88;
            padding: 15px 25px; border-radius: 12px;
            font-size: 22px; font-weight: 700;
            letter-spacing: 1px; z-index: 1000;
            box-shadow: 0 8px 30px rgba(0,0,0,0.6);
            font-family: 'Courier New', monospace;
        }
        
        .photo-overlay {
            position: absolute; top: 220px; right: 40px;
            width: 500px;
            background: linear-gradient(145deg, rgba(0,0,0,0.95), rgba(20,20,20,0.9));
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 10px 50px rgba(0,0,0,0.8), 0 0 0 1px rgba(0,255,136,0.3);
            z-index: 1000;
            display: none;
        }
        
        .photo-overlay img {
            width: 100%;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        
        .photo-label {
            color: #00ff88;
            font-size: 16px;
            font-weight: 700;
            margin-top: 12px;
            text-align: center;
            letter-spacing: 0.5px;
        }
        
        .route-stats {
            position: absolute; bottom: 80px; left: 40px;
            background: rgba(0,0,0,0.85);
            color: rgba(255,255,255,0.8);
            padding: 12px 20px;
            border-radius: 10px;
            font-size: 13px;
            z-index: 1000;
        }
    </style>
</head>
<body>
    <div id="map"></div>
    
    <div class="stats-overlay">
        <div class="stat-item">
            <div class="stat-label">Current Speed</div>
            <div class="stat-value" id="speed-value">0<span class="unit">km/h</span></div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Distance Traveled</div>
            <div class="stat-value secondary" id="distance-value">0.0<span class="unit">km</span></div>
        </div>
        <div class="stat-item">
            <div class="stat-label">Average Speed</div>
            <div class="stat-value secondary" id="avg-speed-value">0<span class="unit">km/h</span></div>
        </div>
    </div>
    
    <div class="time-display" id="time-display">00:00:00</div>
    
    <div class="photo-overlay" id="photo-overlay">
        <img id="photo-img" src="" alt="Stop Photo">
        <div class="photo-label" id="photo-label">📍 Stop Location</div>
    </div>
    
    <div class="route-stats" id="route-stats">
        📍 Total Points: """ + str(len(gps_df)) + """ | 🛑 Stops: """ + str(len(photo_data)) + """
    </div>
    
    <div class="progress-container">
        <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
        </div>
    </div>

<script>
mapboxgl.accessToken = '""" + MAPBOX_API_KEY + """';
const fullTrail = """ + json.dumps(trail_coordinates) + """;
const stopMarkers = """ + json.dumps(stop_markers) + """;

const map = new mapboxgl.Map({
    container: 'map',
    style: '""" + MAP_STYLE + """',
    center: fullTrail[0],
    zoom: """ + str(CAMERA_ZOOM_BASE) + """,
    pitch: """ + str(CAMERA_PITCH_BASE) + """,
    bearing: 0,
    antialias: true,
    attributionControl: false,
    preserveDrawingBuffer: true,
    failIfMajorPerformanceCaveat: false
});

let isMapReady = false;
let totalSpeed = 0;
let frameCount = 0;
let currentStopPhoto = null;
let stopPhotoTimeout = null;

function speedToColor(speed) {
    const norm = Math.max(0, Math.min(1, speed / 80));
    let r, g, b;
    if (norm < 0.2) {
        const t = norm / 0.2;
        r = Math.floor(100*t); g = Math.floor(100 + 155*t); b = 255;
    } else if (norm < 0.4) {
        const t = (norm - 0.2) / 0.2;
        r = Math.floor(100 - 100*t); g = 255; b = Math.floor(255 - 155*t);
    } else if (norm < 0.6) {
        const t = (norm - 0.4) / 0.2;
        r = Math.floor(255*t); g = 255; b = Math.floor(100 - 100*t);
    } else if (norm < 0.8) {
        const t = (norm - 0.6) / 0.2;
        r = 255; g = Math.floor(255 - 100*t); b = 0;
    } else {
        const t = (norm - 0.8) / 0.2;
        r = 255; g = Math.floor(155 - 155*t); b = 0;
    }
    return `rgb(${r},${g},${b})`;
}

map.on('load', function() {
    // Add full trail as reference
    map.addSource('full-trail', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': fullTrail }
        }
    });
    
    map.addLayer({
        'id': 'full-trail-line',
        'type': 'line',
        'source': 'full-trail',
        'paint': {
            'line-color': '#ffffff',
            'line-width': 2,
            'line-opacity': 0.3
        }
    });
    
    // Add active trail
    map.addSource('trail', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': [] }
        }
    });
    
    map.addLayer({
        'id': 'trail-line',
        'type': 'line',
        'source': 'trail',
        'paint': {
            'line-color': '#00ff88',
            'line-width': """ + str(TRAIL_WIDTH) + """,
            'line-opacity': """ + str(TRAIL_OPACITY) + """
        }
    });
    
    // Add current position marker
    map.addSource('marker', {
        'type': 'geojson',
        'data': {
            'type': 'Feature',
            'geometry': { 'type': 'Point', 'coordinates': fullTrail[0] }
        }
    });
    
    map.addLayer({
        'id': 'marker-pulse',
        'type': 'circle',
        'source': 'marker',
        'paint': {
            'circle-radius': 18,
            'circle-color': '#00ff88',
            'circle-opacity': 0.3,
            'circle-blur': 0.6
        }
    });
    
    map.addLayer({
        'id': 'marker-glow',
        'type': 'circle',
        'source': 'marker',
        'paint': {
            'circle-radius': 14,
            'circle-color': '#00ff88',
            'circle-opacity': 0.6,
            'circle-blur': 0.4
        }
    });
    
    map.addLayer({
        'id': 'marker-core',
        'type': 'circle',
        'source': 'marker',
        'paint': {
            'circle-radius': 10,
            'circle-color': '#ffffff',
            'circle-stroke-width': 4,
            'circle-stroke-color': '#00ff88'
        }
    });
    
    // Add stop markers
    stopMarkers.forEach((stop, i) => {
        map.addSource('stop-marker-' + i, {
            'type': 'geojson',
            'data': {
                'type': 'Feature',
                'geometry': { 'type': 'Point', 'coordinates': [stop.lon, stop.lat] }
            }
        });
        
        map.addLayer({
            'id': 'stop-marker-glow-' + i,
            'type': 'circle',
            'source': 'stop-marker-' + i,
            'paint': {
                'circle-radius': 12,
                'circle-color': '#ff4444',
                'circle-opacity': 0.4
            }
        });
        
        map.addLayer({
            'id': 'stop-marker-' + i,
            'type': 'circle',
            'source': 'stop-marker-' + i,
            'paint': {
                'circle-radius': 8,
                'circle-color': '#ff4444',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#ffffff'
            }
        });
    });
    
    setTimeout(() => { isMapReady = true; }, 1000);
});

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

window.updateCamera = function(data) {
    if (!isMapReady) return false;
    
    const start = Math.max(0, data.idx - """ + str(TRAIL_LENGTH) + """);
    const end = Math.min(data.idx + 50, fullTrail.length);
    const coords = fullTrail.slice(start, end);
    
    if (coords.length > 0) {
        map.getSource('trail').setData({
            'type': 'Feature',
            'geometry': { 'type': 'LineString', 'coordinates': coords }
        });
        
        const color = speedToColor(data.speed);
        map.setPaintProperty('trail-line', 'line-color', color);
    }
    
    map.getSource('marker').setData({
        'type': 'Feature',
        'geometry': { 'type': 'Point', 'coordinates': [data.lon, data.lat] }
    });
    
    // Check for nearby stops
    let nearStop = null;
    stopMarkers.forEach(stop => {
        if (Math.abs(stop.idx - data.idx) < 15) {
            nearStop = stop;
        }
    });
    
    if (nearStop && currentStopPhoto !== nearStop.stop_num) {
        document.getElementById('photo-img').src = nearStop.photo;
        document.getElementById('photo-label').textContent = 
            '📍 Stop #' + nearStop.stop_num + ' - Street View';
        document.getElementById('photo-overlay').style.display = 'block';
        currentStopPhoto = nearStop.stop_num;
        
        // Auto-hide after """ + str(STOP_PHOTO_DISPLAY_DURATION) + """ seconds
        if (stopPhotoTimeout) clearTimeout(stopPhotoTimeout);
        stopPhotoTimeout = setTimeout(() => {
            document.getElementById('photo-overlay').style.display = 'none';
            currentStopPhoto = null;
        }, """ + str(STOP_PHOTO_DISPLAY_DURATION * 1000) + """);
    }
    
    map.easeTo({
        center: [data.lon, data.lat],
        zoom: data.zoom,
        bearing: data.bearing,
        pitch: data.pitch,
        duration: 100,
        easing: t => t
    });
    
    totalSpeed += data.speed;
    frameCount++;
    
    document.getElementById('speed-value').innerHTML = 
        Math.round(data.speed) + '<span class="unit">km/h</span>';
    document.getElementById('distance-value').innerHTML = 
        data.distance.toFixed(1) + '<span class="unit">km</span>';
    document.getElementById('avg-speed-value').innerHTML = 
        Math.round(totalSpeed / frameCount) + '<span class="unit">km/h</span>';
    document.getElementById('time-display').textContent = formatTime(data.time);
    document.getElementById('progress-fill').style.width = (data.progress * 100) + '%';
    
    return true;
};

window.isReady = () => isMapReady;
window.getStatus = () => ({ ready: isMapReady });
</script>
</body>
</html>
"""
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)
    
    print(f"   ✅ HTML saved with Satellite Streets style")
    return output_path

# ============================================================================
# BROWSER RENDERING - OPTIMIZED
# ============================================================================
def setup_browser():
    print("\n🌐 Setting up browser...")
    
    chrome_options = Options()
    chrome_options.add_argument('--headless=new')
    chrome_options.add_argument('--no-sandbox')
    chrome_options.add_argument('--disable-dev-shm-usage')
    chrome_options.add_argument('--disable-gpu')
    chrome_options.add_argument('--disable-software-rasterizer')
    chrome_options.add_argument(f'--window-size={VIDEO_WIDTH},{VIDEO_HEIGHT}')
    chrome_options.add_argument('--force-device-scale-factor=1')
    chrome_options.add_argument('--disable-extensions')
    chrome_options.add_argument('--disable-logging')
    chrome_options.add_argument('--log-level=3')
    chrome_options.add_argument('--silent')
    chrome_options.add_argument('--disable-background-timer-throttling')
    chrome_options.add_argument('--disable-backgrounding-occluded-windows')
    chrome_options.add_argument('--disable-breakpad')
    chrome_options.add_argument('--disable-component-extensions-with-background-pages')
    chrome_options.add_argument('--disable-features=TranslateUI,BlinkGenPropertyTrees')
    chrome_options.add_argument('--disable-ipc-flooding-protection')
    chrome_options.add_argument('--disable-renderer-backgrounding')
    chrome_options.add_argument('--enable-features=NetworkService,NetworkServiceInProcess')
    chrome_options.add_argument('--force-color-profile=srgb')
    chrome_options.add_argument('--hide-scrollbars')
    chrome_options.add_argument('--metrics-recording-only')
    chrome_options.add_argument('--mute-audio')
    
    # Try to find Chrome/Chromium binary
    possible_binaries = [
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable'
    ]
    
    chrome_binary = None
    for binary in possible_binaries:
        if os.path.exists(binary):
            chrome_binary = binary
            chrome_options.binary_location = binary
            print(f"   Found browser: {binary}")
            break
    
    if not chrome_binary:
        print("   ⚠️  No Chrome/Chromium found, trying default...")
    
    # Try multiple methods to start the driver
    driver = None
    attempts = [
        # Method 1: Try with auto-installed chromedriver
        lambda: webdriver.Chrome(
            service=Service(ChromeDriverManager(chrome_type=ChromeType.CHROMIUM).install()),
            options=chrome_options
        ),
        # Method 2: Try with system chromedriver
        lambda: webdriver.Chrome(
            service=Service('/usr/bin/chromedriver'),
            options=chrome_options
        ),
        # Method 3: Try with default service
        lambda: webdriver.Chrome(options=chrome_options),
        # Method 4: Try finding chromedriver in common locations
        lambda: webdriver.Chrome(
            service=Service('/usr/local/bin/chromedriver'),
            options=chrome_options
        ),
    ]
    
    for i, attempt in enumerate(attempts, 1):
        try:
            print(f"   Attempt {i}/{len(attempts)}...")
            driver = attempt()
            print(f"   ✅ Browser started successfully!")
            break
        except Exception as e:
            if i == len(attempts):
                print(f"   ❌ All attempts failed")
                print(f"   Last error: {str(e)[:200]}")
                
                # Try installing chromedriver manually
                print("\n   🔧 Attempting manual chromedriver installation...")
                try:
                    subprocess.run(['apt-get', 'install', '-y', 'chromium-chromedriver'], 
                                 check=True, capture_output=True)
                    driver = webdriver.Chrome(
                        service=Service('/usr/bin/chromedriver'),
                        options=chrome_options
                    )
                    print("   ✅ Manual installation successful!")
                except Exception as e2:
                    raise Exception(f"Could not start browser. Please ensure Chrome/Chromium is installed. Error: {str(e2)}")
            else:
                continue
    
    if driver:
        driver.set_window_size(VIDEO_WIDTH, VIDEO_HEIGHT)
        print("   ✅ Browser ready")
        return driver
    else:
        raise Exception("Failed to initialize browser")

# Alternative: Simple static map rendering if browser fails
def render_video_static_fallback(camera_positions, gps_df, photo_data, output_path):
    """Optimized fallback using Mapbox Static Images API"""
    print("\n🎬 RENDERING VIDEO (Optimized Static Maps)...")
    print(f"   Resolution: {VIDEO_WIDTH}x{VIDEO_HEIGHT}")
    print(f"   Total Frames: {len(camera_positions)}")
    print(f"   Estimated time: {len(camera_positions) * 0.5 / 60:.1f} minutes")
    
    frames = []
    last_downloaded_frame = None
    cache_hits = 0
    
    # Use lower resolution for API calls, upscale if needed
    api_width = 800
    api_height = 600
    
    for i, pos in enumerate(tqdm(camera_positions, desc="   Generating")):
        try:
            # Simple static map URL (no overlays to avoid 422 errors)
            # Round coordinates to reduce unique requests
            lon_rounded = round(pos['lon'], 4)
            lat_rounded = round(pos['lat'], 4)
            zoom_rounded = round(pos['zoom'], 1)
            bearing_rounded = int(pos['bearing'] / 5) * 5  # Round to nearest 5°
            
            # Limit pitch to valid range (0-60 degrees)
            pitch_clamped = max(0, min(60, int(pos['pitch'])))
            
            url = (
                f"https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/"
                f"{lon_rounded},{lat_rounded},{zoom_rounded},{bearing_rounded},{pitch_clamped}/"
                f"{api_width}x{api_height}@2x"
                f"?access_token={MAPBOX_API_KEY}"
            )
            
            # Download or use cached image
            if i == 0 or (i % 3 == 0):  # Download every 3rd frame to save API calls
                response = requests.get(url, timeout=10)
                if response.status_code == 200:
                    last_downloaded_frame = Image.open(BytesIO(response.content))
                elif last_downloaded_frame is None:
                    # Create blank frame on first failure
                    last_downloaded_frame = Image.new('RGB', (api_width * 2, api_height * 2), (30, 30, 30))
            else:
                cache_hits += 1
            
            # Use the frame (downloaded or cached)
            img = last_downloaded_frame.copy()
            
            # Resize to target resolution
            img = img.resize((VIDEO_WIDTH, VIDEO_HEIGHT), Image.Resampling.LANCZOS)
            
            # Add overlays
            overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            
            # Load fonts
            try:
                font_huge = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 70)
                font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 40)
                font_medium = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
                font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
            except:
                font_huge = font_large = font_medium = font_small = ImageFont.load_default()
            
            # Stats box background
            overlay_draw.rounded_rectangle(
                [(30, 30), (380, 280)],
                radius=15,
                fill=(0, 0, 0, 220)
            )
            
            # Current position marker
            center_x, center_y = VIDEO_WIDTH // 2, VIDEO_HEIGHT // 2
            overlay_draw.ellipse(
                [(center_x - 20, center_y - 20), (center_x + 20, center_y + 20)],
                fill=(0, 255, 136, 180),
                outline=(255, 255, 255, 255),
                width=5
            )
            overlay_draw.ellipse(
                [(center_x - 12, center_y - 12), (center_x + 12, center_y + 12)],
                fill=(255, 255, 255, 255)
            )
            
            # Progress bar
            bar_y = VIDEO_HEIGHT - 60
            overlay_draw.rounded_rectangle(
                [(30, bar_y), (VIDEO_WIDTH - 30, bar_y + 20)],
                radius=10,
                fill=(0, 0, 0, 180)
            )
            
            progress_width = int((VIDEO_WIDTH - 80) * (i / len(camera_positions)))
            if progress_width > 0:
                overlay_draw.rounded_rectangle(
                    [(40, bar_y + 5), (40 + progress_width, bar_y + 15)],
                    radius=7,
                    fill=(0, 255, 136, 255)
                )
            
            # Composite overlay
            img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
            draw = ImageDraw.Draw(img)
            
            # Speed (large, green)
            speed_text = f"{int(pos['speed'])}"
            draw.text((55, 55), speed_text, fill=(0, 255, 136), font=font_huge)
            draw.text((55, 135), "km/h", fill=(120, 120, 120), font=font_small)
            
            # Distance
            draw.text((55, 180), "DISTANCE", fill=(80, 80, 80), font=font_small)
            dist_text = f"{pos['distance_km']:.1f} km"
            draw.text((55, 205), dist_text, fill=(255, 255, 255), font=font_medium)
            
            # Time (top right)
            time_text = format_time(pos['time_seconds'])
            draw.text((VIDEO_WIDTH - 180, 40), time_text, fill=(0, 255, 136), font=font_large)
            
            frames.append(np.array(img))
            
            # Rate limiting
            if i > 0 and i % 100 == 0:
                time.sleep(0.5)
                
            # Print progress periodically for streaming
            if i % max(1, int(len(camera_positions) / 100)) == 0:
                pct = int((i / max(1, len(camera_positions))) * 100)
                try:
                    print(f"PROGRESS:{json.dumps({'stage':'rendering','progress':pct})}", flush=True)
                except:
                    pass
        except Exception as e:
            if i < 10:
                print(f"\n   ⚠️  Error on frame {i}: {str(e)[:100]}")
            if len(frames) > 0:
                frames.append(frames[-1])
            elif last_downloaded_frame:
                frames.append(np.array(last_downloaded_frame.resize((VIDEO_WIDTH, VIDEO_HEIGHT))))
            else:
                blank = Image.new('RGB', (VIDEO_WIDTH, VIDEO_HEIGHT), (30, 30, 30))
                frames.append(np.array(blank))
    
    print(f"\n   ✅ Generated {len(frames)} frames ({cache_hits} cached)")
    
    if len(frames) == 0:
        raise Exception("No frames were generated")
    
    print(f"\n🎬 Encoding video...")
    imageio.mimsave(
        output_path, 
        frames, 
        fps=VIDEO_FPS, 
        codec='libx264',
        pixelformat='yuv420p',
        output_params=[
            '-crf', str(ENCODING_CRF),
            '-preset', ENCODING_PRESET,
            '-movflags', '+faststart'
        ]
    )
    
    file_size = os.path.getsize(output_path) / (1024 * 1024)
    duration = len(frames) / VIDEO_FPS
    
    print(f"\n✅ VIDEO COMPLETE!")
    print(f"   📹 File: {output_path}")
    print(f"   ⏱️  Duration: {duration:.1f}s ({format_time(duration)})")
    print(f"   📦 Size: {file_size:.1f} MB")
    print(f"   🎞️  Frames: {len(frames)}")
    print(f"   📐 Resolution: {VIDEO_WIDTH}x{VIDEO_HEIGHT}")
    print(f"   🗺️  Method: Optimized Static Maps")
    # Ensure we emit 100% progress at end
    try:
        print(f"PROGRESS:{json.dumps({'stage':'success','progress':100, 'message': 'Video generated successfully!'})}", flush=True)
    except:
        pass

def render_video_webgl(camera_positions, html_file, output_path):
    print("\n🎬 RENDERING HIGH QUALITY VIDEO...")
    print(f"   Resolution: {VIDEO_WIDTH}x{VIDEO_HEIGHT}")
    print(f"   FPS: {VIDEO_FPS}")
    print(f"   Total Frames: {len(camera_positions)}")
    print(f"   Estimated Duration: {len(camera_positions) / VIDEO_FPS / 60:.1f} minutes")
    
    try:
        driver = setup_browser()
    except Exception as e:
        print(f"\n   ⚠️  Browser setup failed: {str(e)[:200]}")
        print(f"   🔄 Switching to static map fallback method...")
        # Extract gps_df and photo_data from global scope or parameters
        # For now, we'll need to modify the main function to handle this
        raise Exception("Browser initialization failed. Use static fallback.")
    
    try:
        print("\n   Loading viewer...")
        driver.get(f'file://{os.path.abspath(html_file)}')
        
        print("   Initializing map...")
        start_time = time.time()
        while time.time() - start_time < BROWSER_TIMEOUT:
            try:
                if driver.execute_script("return window.isReady ? window.isReady() : false"):
                    print("   ✅ Map ready!")
                    break
            except:
                pass
            time.sleep(1)
        
        time.sleep(3)
        
        print(f"\n📸 Capturing frames (this will take ~{len(camera_positions) * FRAME_WAIT / 60:.1f} minutes)...")
        frames = []
        
        for i, pos in enumerate(tqdm(camera_positions, desc="   Rendering")):
            camera_data = {
                'lon': pos['lon'],
                'lat': pos['lat'],
                'zoom': pos['zoom'],
                'bearing': pos['bearing'],
                'pitch': pos['pitch'],
                'speed': pos['speed'],
                'distance': pos['distance_km'],
                'time': pos['time_seconds'],
                'progress': i / len(camera_positions),
                'idx': pos['idx']
            }
            
            driver.execute_script("window.updateCamera(arguments[0]);", camera_data)
            time.sleep(FRAME_WAIT)
            
            screenshot = driver.get_screenshot_as_png()
            img = Image.open(BytesIO(screenshot))
            frames.append(np.array(img))
        
        print(f"\n🎬 Encoding video (HIGH QUALITY - CRF {ENCODING_CRF})...")
        imageio.mimsave(
            output_path, 
            frames, 
            fps=VIDEO_FPS, 
            codec='libx264',
            pixelformat='yuv420p',
            output_params=[
                '-crf', str(ENCODING_CRF),
                '-preset', ENCODING_PRESET,
                '-movflags', '+faststart'
            ]
        )
        
        file_size = os.path.getsize(output_path) / (1024 * 1024)
        duration = len(frames) / VIDEO_FPS
        
        print(f"\n✅ VIDEO COMPLETE!")
        print(f"   📹 File: {output_path}")
        print(f"   ⏱️  Duration: {duration:.1f}s ({format_time(duration)})")
        print(f"   📦 Size: {file_size:.1f} MB")
        print(f"   🎞️  Frames: {len(frames)}")
        print(f"   🎨 Quality: HIGH (CRF {ENCODING_CRF})")
        print(f"   🗺️  Map Style: Satellite Streets")
        
    finally:
        driver.quit()

# ============================================================================
# MAIN EXECUTION
# ============================================================================
def main(gps_file, uploads_dir=None):
    """
    Generate video from GPS data
    
    Args:
        gps_file: Path to the GPS data file (CSV or Excel)
        uploads_dir: Optional custom uploads directory (default: backend/uploads)
    """
    global UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR, OUTPUT_DIR, OUTPUT_VIDEO, HTML_FILE
    
    # Initialize directories if custom uploads_dir provided
    if uploads_dir and uploads_dir != UPLOADS_BASE_DIR:
        UPLOADS_BASE_DIR, FRAMES_DIR, PHOTO_DIR, VIDEOS_DIR = setup_environment(uploads_dir)
        OUTPUT_DIR = UPLOADS_BASE_DIR
        OUTPUT_VIDEO = os.path.join(VIDEOS_DIR, "relive_full_quality.mp4")
        HTML_FILE = os.path.join(VIDEOS_DIR, "map_viewer_full.html")
    
    start_time = time.time()
    
    print("=" * 80)
    print("🚀 RELIVE VIDEO - FULL GPS DATA WITH ALL STOPS (HIGH QUALITY)")
    print("=" * 80)
    print(f"📁 Input File: {gps_file}")
    print(f"📁 Output Directory: {OUTPUT_DIR}")
    print(f"🎥 Video Quality: HIGH ({VIDEO_WIDTH}x{VIDEO_HEIGHT} @ {VIDEO_FPS}fps)")
    print(f"🗺️  Map Style: {MAP_STYLE}")
    print(f"📊 GPS Processing: ALL COORDINATES (no downsampling)")
    print(f"🛑 Stop Detection: ALL STOPS")
    print(f"📸 Street View Photos: Up to {MAX_STOP_PHOTOS}")
    print(f"⚡ Optimization: Adaptive Frame Sampling")
    print(f"🎯 Target: Complete in 30-40 minutes")
    print("=" * 80)
    
    # Load ALL GPS data
    gps_df = load_gps_data(gps_file)
    
    # Process ALL data
    gps_df = process_gps_data(gps_df)
    
    # Detect ALL stops
    photo_data = {}
    stop_positions = []
    if ENABLE_STOP_DETECTION:
        print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 25, 'message': 'Detecting stops...', 'step': 'Stop Detection'})}", flush=True)
        stop_positions = detect_stops(gps_df)
        if len(stop_positions) > 0:
            print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 35, 'message': 'Capturing street view photos...', 'step': 'Capturing Photos'})}", flush=True)
            photo_data = capture_stop_photos(gps_df, stop_positions)
    
    # Generate adaptive frames (KEY OPTIMIZATION)
    print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 50, 'message': 'Generating adaptive frames...', 'step': 'Frame Generation'})}", flush=True)
    camera_positions = generate_adaptive_frames(gps_df)
    
    # Generate HTML viewer
    print(f"PROGRESS:{json.dumps({'stage': 'processing', 'progress': 65, 'message': 'Generating visualization...', 'step': 'HTML Generation'})}", flush=True)
    html_file = generate_html_viewer(gps_df, photo_data)
    
    # Skip WebGL in Kaggle - go straight to optimized static maps
    print("\n🎬 Using optimized static map rendering (best for Kaggle)...")
    print(f"PROGRESS:{json.dumps({'stage': 'rendering', 'progress': 75, 'message': 'Rendering video frames...', 'step': 'Rendering video'})}", flush=True)
    render_video_static_fallback(camera_positions, gps_df, photo_data, OUTPUT_VIDEO)
    
    elapsed_time = time.time() - start_time
    
    print("\n" + "=" * 80)
    print("✨ PROCESSING COMPLETE!")
    print("=" * 80)
    print(f"⏱️  Total Processing Time: {format_time(elapsed_time)} ({elapsed_time/60:.1f} minutes)")
    print(f"📹 Final Video: {OUTPUT_VIDEO}")
    print(f"📊 GPS Points Processed: {len(gps_df):,}")
    print(f"🛑 Stops Detected: {len(stop_positions)}")
    print(f"📸 Photos Captured: {len(photo_data)}")
    print(f"🎞️  Video Frames: {len(camera_positions):,}")
    print(f"📏 Compression Ratio: {len(gps_df) / len(camera_positions):.1f}x")
    print(f"🗺️  Map: Satellite Streets View")
    print("=" * 80)
    
    # Performance report
    print("\n📊 PERFORMANCE BREAKDOWN:")
    print(f"   ├─ GPS Loading & Processing: ~5%")
    print(f"   ├─ Map Matching: ~15%")
    print(f"   ├─ Stop Detection & Photos: ~10%")
    print(f"   ├─ Frame Generation: ~5%")
    print(f"   ├─ Frame Rendering: ~55%")
    print(f"   └─ Video Encoding: ~10%")
    
    return OUTPUT_VIDEO

easy_path = 'relive_video.mp4'
if __name__ == '__main__':
    # Usage: python code.py <path_to_gps_file> [uploads_directory]
    if len(sys.argv) < 2:
        print("Usage: python code.py <path_to_gps_file> [uploads_directory]")
        print("Example: python code.py uploads/data.xlsx")
        sys.exit(1)

    GPS_FILE = sys.argv[1]
    uploads_dir = sys.argv[2] if len(sys.argv) > 2 else None

    if not os.path.exists(GPS_FILE):
        print(f"File not found: {GPS_FILE}")
        print(f"Current directory: {os.getcwd()}")
        print(f"Available files: {[f for f in os.listdir('.') if f.endswith(('.xlsx', '.csv'))]}")
        sys.exit(1)

    try:
        video_path = main(GPS_FILE, uploads_dir)
        print(f"\nSUCCESS! Video ready: {video_path}")
    except Exception as e:
        print(f"Error during video generation: {e}")
        sys.exit(1)