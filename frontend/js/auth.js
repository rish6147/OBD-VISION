// frontend/js/auth.js

const API_BASE = "http://127.0.0.1:5000/api"; // change if your backend is on a different port

// ------------------ Form Switch ------------------
function switchForm(formType) {
    event.preventDefault();
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');

    if (formType === 'signup') {
        loginForm.classList.remove('active');
        setTimeout(() => {
            signupForm.classList.add('active');
        }, 300);
    } else {
        signupForm.classList.remove('active');
        setTimeout(() => {
            loginForm.classList.add('active');
        }, 300);
    }
}

// ------------------ Toggle Password Visibility ------------------
function togglePassword(inputId) {
    const input = document.getElementById(inputId);
    input.type = input.type === 'password' ? 'text' : 'password';
}

// ------------------ Show Success/Message ------------------
function showMessage(message, isError = false) {
    const msgEl = document.getElementById('successMessage');
    const textEl = document.getElementById('successText');
    textEl.textContent = message;
    msgEl.style.color = isError ? 'red' : 'green';
    msgEl.classList.add('show');
    setTimeout(() => {
        msgEl.classList.remove('show');
    }, 4000);
}

// ------------------ Handle Signup ------------------
async function handleSignup(event) {
    event.preventDefault();
    const firstName = document.getElementById('signup-firstname').value.trim();
    const lastName = document.getElementById('signup-lastname').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;

    if (password !== confirm) {
        showMessage('Passwords do not match!', true);
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, email, password, confirmPassword: confirm }),
            credentials: 'include' // must include cookies
        });

        const data = await res.json();

        if (data.success) {
            showMessage('Account created successfully! Redirecting to login...');
            setTimeout(() => switchForm('login'), 2000);
        } else {
            showMessage(data.error || 'Signup failed', true);
        }
    } catch (err) {
        console.error(err);
        showMessage('Server error', true);
    }
}

// ------------------ Handle Login ------------------
async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
            credentials: 'include' // include cookies for JWT
        });

        const data = await res.json();

        if (data.success) {
            showMessage('Login successful! Redirecting...');
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);
        } else {
            showMessage(data.error || 'Login failed', true);
        }
    } catch (err) {
        console.error(err);
        showMessage('Server error', true);
    }
}

// ------------------ Social Login (placeholder) ------------------
function socialLogin(provider) {
    showMessage(`Connecting to ${provider}...`);
    console.log('Social login with:', provider);
}

// ------------------ Keyboard shortcut: Alt+S ------------------
document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 's') {
        const loginActive = document.getElementById('loginForm').classList.contains('active');
        switchForm(loginActive ? 'signup' : 'login');
    }
});

// ------------------ Event Listeners ------------------
document.getElementById('signupBtn')?.addEventListener('click', handleSignup);
document.getElementById('loginBtn')?.addEventListener('click', handleLogin);
