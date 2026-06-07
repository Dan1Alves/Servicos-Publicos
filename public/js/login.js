function persistSession(token, role, city) {
  if (token && role) {
    sessionStorage.setItem('painelToken', token);
    sessionStorage.setItem('painelRole', role);
  }
  if (city) {
    sessionStorage.setItem('painelCityLock', JSON.stringify(city));
  } else {
    sessionStorage.removeItem('painelCityLock');
  }
}

async function loadBrandingForLogin() {
  try {
    const res = await fetch('/api/public/config');
    const data = await res.json();
    applyLoginBranding(data.branding);
  } catch (error) {
    console.warn('Não foi possível carregar branding institucional para o login.', error);
  }
}

function applyLoginBranding(branding) {
  if (!branding) return;
  const root = document.documentElement;
  if (branding.cardBackground) {
    root.style.setProperty('--card-background', branding.cardBackground);
  }
  if (branding.cardBorderColor) {
    root.style.setProperty('--card-border', branding.cardBorderColor);
  }
  if (branding.pageBackground) {
    root.style.setProperty('--surface', branding.pageBackground);
  }
  if (branding.loginBackground) {
    document.body.style.background = branding.loginBackground;
  }
  if (branding.loginImage) {
    document.body.style.backgroundImage = `linear-gradient(135deg, rgba(4, 9, 20, 0.8), rgba(2, 5, 12, 0.55)), url(${branding.loginImage})`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
  }
  const eyebrow = document.getElementById('loginEyebrow');
  if (eyebrow && branding.organization) {
    eyebrow.textContent = branding.organization;
  }
  const heading = document.getElementById('loginHeading');
  if (heading) {
    heading.textContent = branding.heroTitle || 'Painel Gestão Urbana';
  }
  const description = document.getElementById('loginDescription');
  if (description && branding.heroSubtitle) {
    description.textContent = branding.heroSubtitle;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBrandingForLogin();
  const form = document.getElementById('loginForm');
  const result = document.getElementById('loginResult');
  const message = sessionStorage.getItem('painelMessage');
  if (message) {
    result.textContent = message;
    sessionStorage.removeItem('painelMessage');
  }
  const existingToken = sessionStorage.getItem('painelToken');
  const existingRole = sessionStorage.getItem('painelRole');
  if (existingToken && existingRole) {
    window.location.href = '/painel';
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    result.textContent = 'Autenticando...';
    try {
      const payload = {
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      };
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Credenciais inválidas');
      }
      persistSession(data.token, data.role, data.city || null);
      result.textContent = '';
      window.location.href = '/painel';
    } catch (error) {
      result.textContent = error.message || 'Falha ao autenticar.';
    }
  });
});
