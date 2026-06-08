const STATUS_LABELS = {
  aberto: 'Aberto',
  em_andamento: 'Em andamento',
  resolvido: 'Resolvido'
};

const panelState = {
  token: null,
  role: null,
  citySlug: null,
  lockedCity: null,
  cityInfo: null,
  setupRequired: false,
  cities: [],
  reports: [],
  map: null,
  mapLayer: null
};

function persistSession(token, role) {
  panelState.token = token;
  panelState.role = role;
  if (token && role) {
    sessionStorage.setItem('painelToken', token);
    sessionStorage.setItem('painelRole', role);
  } else {
    sessionStorage.removeItem('painelToken');
    sessionStorage.removeItem('painelRole');
  }
}

function persistCityLock(city) {
  panelState.lockedCity = city || null;
  if (city) {
    sessionStorage.setItem('painelCityLock', JSON.stringify(city));
  } else {
    sessionStorage.removeItem('painelCityLock');
  }
}

function authFetch(url, options = {}) {
  if (!panelState.token) {
    throw new Error('Sessão inexistente');
  }
  const headers = options.headers ? { ...options.headers } : {};
  headers['Authorization'] = `Bearer ${panelState.token}`;
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers }).then(async (res) => {
    if (res.status === 401) {
      handleLogout('Sessão expirada. Faça login novamente.');
      throw new Error('Sessão expirada');
    }
    if (!res.ok) {
      let errorMessage = 'Falha na requisição';
      try {
        const data = await res.json();
        errorMessage = data.error || errorMessage;
      } catch (_) {
        // mantém mensagem padrão
      }
      throw new Error(errorMessage);
    }
    return res;
  });
}

function handleLogout(message) {
  persistSession(null, null);
  persistCityLock(null);
  panelState.citySlug = null;
  if (message) {
    sessionStorage.setItem('painelMessage', message);
  }
  window.location.href = '/login';
}

function composeUrl(base, extraQuery = '') {
  const params = [];
  if (panelState.citySlug) {
    params.push(`city=${encodeURIComponent(panelState.citySlug)}`);
  }
  if (extraQuery) {
    params.push(extraQuery);
  }
  return params.length ? `${base}?${params.join('&')}` : base;
}

document.addEventListener('DOMContentLoaded', () => {
  const logoutButton = document.getElementById('logoutButton');
  const panelFooter = document.getElementById('panelFooter');
  const panelApp = document.getElementById('panelApp');
  const sidebarNav = document.getElementById('sidebarNav');
  const panelViews = document.querySelectorAll('.panel-view');
  const sidebarLinks = sidebarNav ? Array.from(sidebarNav.querySelectorAll('.sidebar-link')) : [];
  const devNavLinks = sidebarNav ? Array.from(sidebarNav.querySelectorAll('.sidebar-link.dev-only')) : [];
  const devViews = Array.from(document.querySelectorAll('.panel-view.dev-only'));
  const roleLabel = document.getElementById('userRoleLabel');
  const panelStats = document.getElementById('panelStats');
  const reportsTableBody = document.querySelector('#reportsTable tbody');
  const exportBtn = document.getElementById('exportCsv');
  const citySelector = document.getElementById('panelCitySelector');
  const citySwitcher = document.querySelector('.city-switcher');
  const cityCenterForm = document.getElementById('cityCenterForm');
  const cityCenterResult = document.getElementById('cityCenterResult');
  const cityPublicUrl = document.getElementById('cityPublicUrl');
  const citySetupModal = document.getElementById('citySetupModal');
  const citySetupForm = document.getElementById('citySetupForm');
  const citySetupResult = document.getElementById('citySetupResult');
  const filterIds = ['filterBairro', 'filterRua', 'filterStatus', 'filterService', 'filterStart', 'filterEnd'];

  panelState.map = L.map('panelMap', { zoomControl: true });
  panelState.mapLayer = L.layerGroup().addTo(panelState.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(panelState.map);
  panelState.map.setView([-23.55052, -46.633308], 13);

  const savedToken = sessionStorage.getItem('painelToken');
  const savedRole = sessionStorage.getItem('painelRole');
  const savedCityLock = sessionStorage.getItem('painelCityLock');
  if (savedCityLock) {
    try {
      const city = JSON.parse(savedCityLock);
      persistCityLock(city);
      if (city?.slug) {
        panelState.citySlug = city.slug;
      }
    } catch (_) {
      persistCityLock(null);
    }
  }
  if (!savedToken || !savedRole) {
    window.location.href = '/login';
    return;
  }
  persistSession(savedToken, savedRole);
  unlockPanel();

  sidebarNav?.addEventListener('click', (event) => {
    const button = event.target.closest('.sidebar-link');
    if (!button) return;
    if (button.classList.contains('dev-only') && panelState.role !== 'dev') return;
    navigateToView(button.dataset.view);
  });

  logoutButton.addEventListener('click', (event) => {
    event.preventDefault();
    handleLogout('Sessão encerrada.');
  });

  exportBtn.addEventListener('click', async () => {
    try {
      const query = buildQuery(filterIds);
      const res = await authFetch(composeUrl('/api/admin/export', query));
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'relatorio-chamados.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message || 'Não foi possível exportar os dados.');
    }
  });

  filterIds.forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('change', loadReports);
  });

  citySelector?.addEventListener('change', (event) => {
    if (panelState.role !== 'dev') return;
    panelState.citySlug = event.target.value || null;
    refreshDashboard();
  });

  function navigateToView(targetView) {
    if (!targetView) return;
    panelViews.forEach((section) => {
      const isActive = section.dataset.view === targetView;
      section.classList.toggle('active', isActive);
    });
    sidebarLinks.forEach((link) => {
      const isActive = link.dataset.view === targetView;
      link.classList.toggle('active', isActive);
    });
    if (targetView === 'dashboard' && panelState.map) {
      setTimeout(() => {
        panelState.map.invalidateSize();
      }, 200);
    }
  }

  function toggleDevAccess(isDev) {
    devNavLinks.forEach((link) => {
      link.style.display = isDev ? 'block' : 'none';
    });
    if (!isDev) {
      const activeDevView = devViews.find((view) => view.classList.contains('active'));
      if (activeDevView) {
        navigateToView('dashboard');
      }
    }
    devViews.forEach((view) => {
      view.toggleAttribute('hidden', !isDev);
      if (!isDev) {
        view.classList.remove('active');
      }
    });
    if (citySwitcher) {
      citySwitcher.style.display = isDev ? 'flex' : 'none';
    }
  }

  function refreshDashboard() {
    loadMeta();
    loadDashboard();
    loadReports();
  }

  async function unlockPanel() {
    if (panelFooter) panelFooter.removeAttribute('hidden');
    if (panelApp) panelApp.removeAttribute('hidden');
    if (roleLabel) roleLabel.textContent = panelState.role === 'dev' ? 'Dev' : 'Admin';
    toggleDevAccess(panelState.role === 'dev');
    navigateToView('dashboard');
    await loadCitySelector();
    refreshDashboard();
    if (panelState.role === 'dev') {
      await fetchBranding();
      loadDevData();
    }
  }

  async function loadCitySelector() {
    try {
      const res = await fetch('/api/public/config');
      const data = await res.json();
      panelState.cities = data.cities || [];
      const selectedExists = panelState.cities.some((city) => city.slug === panelState.citySlug);
      if (panelState.citySlug && !selectedExists && !panelState.lockedCity) {
        panelState.citySlug = data.defaultCity?.slug || panelState.cities[0]?.slug || null;
      }
      if (panelState.lockedCity?.slug) {
        const match = panelState.cities.find((city) => city.slug === panelState.lockedCity.slug);
        if (match) {
          panelState.lockedCity = match;
        }
        panelState.citySlug = panelState.lockedCity.slug;
      } else if (!panelState.citySlug) {
        panelState.citySlug = data.defaultCity?.slug || panelState.cities[0]?.slug || null;
      }
      if (citySelector) {
        const switcher = citySelector.closest('.city-switcher');
        const list = panelState.lockedCity ? [panelState.lockedCity] : panelState.cities;
        citySelector.innerHTML = '';
        list.forEach((city) => {
          const option = document.createElement('option');
          option.value = city.slug;
          option.textContent = city.name;
          citySelector.appendChild(option);
        });
        if (panelState.citySlug) {
          citySelector.value = panelState.citySlug;
        }
        const isLocked = panelState.role !== 'dev';
        citySelector.disabled = isLocked;
        if (switcher) {
          switcher.classList.toggle('locked', isLocked);
        }
      }
      populateUserCityOptions();
    } catch (error) {
      console.error(error);
    }
  }

  function populateUserCityOptions() {
    const userCitySelect = document.getElementById('userCitySelect');
    if (!userCitySelect) return;
    userCitySelect.innerHTML = '<option value=\"\">Selecione a cidade (obrigatório para Admin)</option>';
    panelState.cities.forEach((city) => {
      const option = document.createElement('option');
      option.value = city.slug;
      option.textContent = city.name;
      userCitySelect.appendChild(option);
    });
  }

  async function loadMeta() {
    try {
      const res = await authFetch(composeUrl('/api/admin/meta'));
      const data = await res.json();
      panelState.cityInfo = data.city || null;
      if (!panelState.citySlug && data.city?.slug) {
        panelState.citySlug = data.city.slug;
        if (citySelector) citySelector.value = panelState.citySlug;
      }
      document.getElementById('panelCity').textContent = data.city ? data.city.name : 'Selecione uma cidade';
      populateCityCenterForm(data.city);
      panelState.setupRequired = Boolean(data.setupRequired);
      toggleCitySetup(panelState.setupRequired, data.city);
      fillSelect('filterBairro', data.bairros || [], 'Bairro');
      fillSelect('filterRua', data.ruas || [], 'Rua');
      fillSelect('filterStatus', (data.statuses || []).map((value) => ({ value, label: STATUS_LABELS[value] || value })), 'Status');
      fillSelect('filterService', (data.services || []).map((service) => ({ value: service.slug, label: service.name })), 'Serviço');
    } catch (error) {
      console.error(error);
    }
  }

  async function loadDashboard() {
    try {
      const res = await authFetch(composeUrl('/api/admin/dashboard'));
      const data = await res.json();
      const stats = [
        { label: 'Total', value: data.stats?.totalReports ?? '--' },
        { label: 'Abertos', value: data.stats?.status?.aberto ?? 0 },
        { label: 'Em andamento', value: data.stats?.status?.em_andamento ?? 0 },
        { label: 'Resolvidos', value: data.stats?.status?.resolvido ?? 0 },
        { label: 'Tempo médio (min)', value: data.stats?.averageResolutionMinutes ?? '--' }
      ];
      panelStats.innerHTML = '';
      stats.forEach((item) => {
        const card = document.createElement('article');
        card.className = 'stat-card';
        card.innerHTML = `<span>${item.label}</span><strong>${item.value}</strong>`;
        panelStats.appendChild(card);
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function loadReports() {
    try {
      const query = buildQuery(filterIds);
      const res = await authFetch(composeUrl('/api/admin/reports', query));
      panelState.reports = await res.json();
      renderReports();
      renderMap();
    } catch (error) {
      console.error(error);
    }
  }

  function renderReports() {
    reportsTableBody.innerHTML = '';
    if (!panelState.reports.length) {
      const emptyRow = document.createElement('tr');
      emptyRow.innerHTML = '<td colspan="5">Nenhum chamado encontrado para os filtros selecionados.</td>';
      reportsTableBody.appendChild(emptyRow);
      return;
    }

    panelState.reports.forEach((report) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${report.protocol}<br/><small>${formatDate(report.created_at)}</small></td>
        <td>${report.bairro || '--'}<br/><small>${report.rua || ''}</small></td>
        <td>${report.type}</td>
        <td><span class="badge ${report.status}">${STATUS_LABELS[report.status] || report.status}</span></td>
        <td class="report-actions">
          <select data-id="${report.id}" class="status-select">
            ${Object.keys(STATUS_LABELS).map((value) => `<option value="${value}" ${report.status === value ? 'selected' : ''}>${STATUS_LABELS[value]}</option>`).join('')}
          </select>
          <input type="text" data-note="${report.id}" placeholder="Observação" />
          <button type="button" class="btn btn-outline" data-save="${report.id}">Salvar</button>
        </td>`;
      reportsTableBody.appendChild(tr);
    });

    reportsTableBody.querySelectorAll('button[data-save]').forEach((button) => {
      button.addEventListener('click', handleSaveReport);
    });
  }

  async function handleSaveReport(event) {
    const id = event.currentTarget.getAttribute('data-save');
    const status = document.querySelector(`select[data-id="${id}"]`).value;
    const note = document.querySelector(`input[data-note="${id}"]`).value.trim();
    try {
      await authFetch(`/api/admin/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, note })
      });
      loadReports();
      loadDashboard();
    } catch (error) {
      alert(error.message || 'Erro ao atualizar o chamado.');
    }
  }

  function renderMap() {
    panelState.mapLayer.clearLayers();
    if (!panelState.reports.length) {
      const fallbackLat = panelState.cityInfo?.default_lat ?? -23.55052;
      const fallbackLng = panelState.cityInfo?.default_lng ?? -46.633308;
      const fallbackZoom = panelState.cityInfo?.default_zoom ?? 13;
      panelState.map.setView([fallbackLat, fallbackLng], fallbackZoom);
      return;
    }
    const bounds = [];
    panelState.reports.forEach((report) => {
      const lat = report.post_lat ?? report.browser_lat;
      const lng = report.post_lng ?? report.browser_lng;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      const color = report.status === 'resolvido' ? '#0f8f6b' : report.status === 'em_andamento' ? '#e3a008' : '#c0392b';
      const marker = L.circleMarker([lat, lng], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.85
      }).addTo(panelState.mapLayer);
      marker.bindPopup(`<strong>${report.protocol}</strong><br/>${report.rua || ''}<br/>${STATUS_LABELS[report.status] || report.status}`);
      bounds.push([lat, lng]);
    });
    if (bounds.length) {
      const leafletBounds = L.latLngBounds(bounds);
      panelState.map.fitBounds(leafletBounds, { padding: [20, 20] });
    }
  }

  function populateCityCenterForm(city) {
    if (!cityCenterForm || !city) return;
    cityCenterForm.elements.namedItem('name').value = city.name || '';
    cityCenterForm.elements.namedItem('default_lat').value = city.default_lat ?? '';
    cityCenterForm.elements.namedItem('default_lng').value = city.default_lng ?? '';
    cityCenterForm.elements.namedItem('default_zoom').value = city.default_zoom ?? 13;
    if (cityPublicUrl) {
      const publicPath = `/${city.slug}`;
      cityPublicUrl.href = `${window.location.origin}${publicPath}`;
      cityPublicUrl.textContent = publicPath;
    }
  }

  function populateCitySetupForm(city) {
    if (!citySetupForm || !city) return;
    citySetupForm.elements.namedItem('name').value = city.name || '';
    citySetupForm.elements.namedItem('default_lat').value = city.default_lat ?? '';
    citySetupForm.elements.namedItem('default_lng').value = city.default_lng ?? '';
    citySetupForm.elements.namedItem('default_zoom').value = city.default_zoom ?? 13;
  }

  function toggleCitySetup(shouldShow, city) {
    if (!citySetupModal || panelState.role !== 'admin') return;
    if (shouldShow && city) {
      populateCitySetupForm(city);
      citySetupModal.removeAttribute('hidden');
      document.body.classList.add('setup-open');
    } else {
      citySetupModal.setAttribute('hidden', '');
      document.body.classList.remove('setup-open');
    }
  }

  function fillSelect(id, items, label) {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Todos${label ? ` os ${label.toLowerCase()}` : ''}</option>`;
    items.forEach((item) => {
      const option = document.createElement('option');
      if (typeof item === 'string') {
        option.value = item;
        option.textContent = item;
      } else {
        option.value = item.value;
        option.textContent = item.label;
      }
      select.appendChild(option);
    });
    if (current) {
      select.value = current;
    }
  }

  function buildQuery(ids) {
    const params = new URLSearchParams();
    const mapKeys = {
      filterBairro: 'bairro',
      filterRua: 'rua',
      filterStatus: 'status',
      filterService: 'service_slug',
      filterStart: 'start',
      filterEnd: 'end'
    };
    ids.forEach((id) => {
      const value = document.getElementById(id).value;
      if (value) {
        params.set(mapKeys[id], value);
      }
    });
    return params.toString();
  }

  function formatDate(value) {
    if (!value) return '--';
    return new Date(value).toLocaleString('pt-BR');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  async function saveCitySettings(form, resultEl, successMessage) {
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.name = String(payload.name || '').trim();
    payload.default_lat = Number(payload.default_lat);
    payload.default_lng = Number(payload.default_lng);
    payload.default_zoom = Number(payload.default_zoom);
    if (resultEl) {
      resultEl.textContent = 'Salvando...';
    }
    const res = await authFetch(composeUrl('/api/admin/city'), {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    panelState.cityInfo = data.city || panelState.cityInfo;
    panelState.setupRequired = Boolean(data.setupRequired);
    if (panelState.role === 'admin' && data.city) {
      persistCityLock(data.city);
      panelState.citySlug = data.city.slug;
    }
    document.getElementById('panelCity').textContent = panelState.cityInfo?.name || 'Selecione uma cidade';
    populateCityCenterForm(panelState.cityInfo);
    populateCitySetupForm(panelState.cityInfo);
    renderMap();
    toggleCitySetup(panelState.setupRequired, panelState.cityInfo);
    if (resultEl) {
      resultEl.textContent = successMessage;
    }
    await loadCitySelector();
    return data;
  }

  // -------- Ferramentas Dev --------
  const postForm = document.getElementById('postForm');
  const postsTableBody = document.querySelector('#postsTable tbody');
  const serviceForm = document.getElementById('serviceForm');
  const servicesList = document.getElementById('servicesList');
  const brandingForm = document.getElementById('brandingForm');
  const cityForm = document.getElementById('cityForm');
  const userForm = document.getElementById('userForm');
  const userCitySelect = document.getElementById('userCitySelect');
  const userRoleSelect = userForm?.querySelector('select[name="role"]');
  const citiesTableBody = document.querySelector('#citiesTable tbody');
  const usersTableBody = document.querySelector('#usersTable tbody');

  function populateBrandingForm(branding) {
    if (!brandingForm || !branding) return;
    const contact = branding.contact || {};
    const heroCta = branding.heroCta || {};
    const values = {
      organization: branding.organization || '',
      cityName: branding.cityName || '',
      heroTitle: branding.heroTitle || '',
      heroSubtitle: branding.heroSubtitle || '',
      inlineHelperText: branding.inlineHelperText || '',
      inlineButtonText: branding.inlineButtonText || '',
      serviceModalTitle: branding.serviceModalTitle || '',
      serviceModalSubtitle: branding.serviceModalSubtitle || '',
      serviceModalOverlay: branding.serviceModalOverlay || '',
      serviceModalBackground: branding.serviceModalBackground || '#ffffff',
      serviceModalBorderColor: branding.serviceModalBorderColor || '',
      inlineCardTitle: branding.inlineCardTitle || '',
      inlineEmptyText: branding.inlineEmptyText || '',
      inlineCardBackground: branding.inlineCardBackground || '',
      inlineCardBorder: branding.inlineCardBorder || '',
      inlineCardTextColor: branding.inlineCardTextColor || '#ffffff',
      inlineCardMutedColor: branding.inlineCardMutedColor || '',
      inlineCardButtonBorder: branding.inlineCardButtonBorder || '',
      drawerTipText: branding.drawerTipText || '',
      drawerBackground: branding.drawerBackground || '#ffffff',
      drawerTextColor: branding.drawerTextColor || '#0f253c',
      reportModalTitle: branding.reportModalTitle || '',
      reportModalDescription: branding.reportModalDescription || '',
      reportSubmitLabel: branding.reportSubmitLabel || '',
      modalBackground: branding.modalBackground || '#ffffff',
      modalTextColor: branding.modalTextColor || '#0f253c',
      heroCtaText: heroCta.text || '',
      heroCtaLink: heroCta.link || '',
      primaryColor: branding.primaryColor || '#0b1f33',
      secondaryColor: branding.secondaryColor || '#1f3b57',
      accentColor: branding.accentColor || '#e6ecf5',
      pageBackground: branding.pageBackground || '#f4f6fb',
      heroBackground: branding.heroBackground || '',
      loginBackground: branding.loginBackground || '',
      heroImage: branding.heroImage || '',
      loginImage: branding.loginImage || '',
      aboutText: branding.aboutText || '',
      transparencyText: branding.transparencyText || '',
      contact_email: contact.email || '',
      contact_phone: contact.phone || '',
      contact_whatsapp: contact.whatsapp || '',
      footerNote: branding.footerNote || '',
      mapStyleUrl: branding.mapStyleUrl || ''
    };
    Object.entries(values).forEach(([name, value]) => {
      const field = brandingForm.elements.namedItem(name);
      if (field) field.value = value ?? '';
    });
  }

  function buildBrandingPayload() {
    if (!brandingForm) return {};
    const formData = new FormData(brandingForm);
    const payload = {};
    const contact = { email: '', phone: '', whatsapp: '' };
    const heroCta = { text: '', link: '' };
    formData.forEach((rawValue, key) => {
      const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
      switch (key) {
        case 'heroCtaText':
          heroCta.text = value;
          break;
        case 'heroCtaLink':
          heroCta.link = value;
          break;
        case 'contact_email':
          contact.email = value;
          break;
        case 'contact_phone':
          contact.phone = value;
          break;
        case 'contact_whatsapp':
          contact.whatsapp = value;
          break;
        default:
          payload[key] = value;
      }
    });
    payload.contact = contact;
    payload.heroCta = heroCta;
    return payload;
  }

  function syncUserCityRequirement() {
    if (!userCitySelect || !userRoleSelect) return;
    userCitySelect.required = userRoleSelect.value === 'admin';
  }

  userRoleSelect?.addEventListener('change', syncUserCityRequirement);
  syncUserCityRequirement();

  function loadDevData() {
    fetchPosts();
    fetchServices();
    fetchCities();
    fetchUsers();
  }

  async function fetchPosts() {
    try {
      const res = await authFetch('/api/dev/posts?city=all');
      const posts = await res.json();
      postsTableBody.innerHTML = '';
      posts.slice(0, 50).forEach((post) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${post.post_uid}</td><td>${post.city_name}</td><td>${post.bairro || ''}</td><td>${post.lat}</td><td>${post.lng}</td>`;
        postsTableBody.appendChild(tr);
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchServices() {
    try {
      const res = await authFetch('/api/dev/services');
      const services = await res.json();
      servicesList.innerHTML = '';
      services.forEach((service) => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${service.name}</strong> — ${service.status} (slug: ${service.slug})`;
        servicesList.appendChild(li);
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchCities() {
    if (!citiesTableBody) return;
    try {
      const res = await authFetch('/api/dev/cities');
      const cities = await res.json();
      citiesTableBody.innerHTML = '';
      if (!cities.length) {
        citiesTableBody.innerHTML = '<tr><td colspan="5">Nenhuma cidade cadastrada.</td></tr>';
        return;
      }
      cities.forEach((city) => {
        const tr = document.createElement('tr');
        const center = `${city.default_lat}, ${city.default_lng} / z${city.default_zoom || 13}`;
        tr.innerHTML = `
          <td>${escapeHtml(city.name)}</td>
          <td>${escapeHtml(city.slug)}</td>
          <td>${escapeHtml(center)}</td>
          <td>${Number(city.active) === 1 ? 'Ativa' : 'Inativa'}</td>
          <td class="table-actions">
            <button type="button" class="btn btn-danger" data-delete-city="${city.id}" data-city-name="${escapeHtml(city.name)}">Apagar</button>
          </td>`;
        citiesTableBody.appendChild(tr);
      });
      citiesTableBody.querySelectorAll('button[data-delete-city]').forEach((button) => {
        button.addEventListener('click', handleDeleteCity);
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function fetchUsers() {
    if (!usersTableBody) return;
    try {
      const res = await authFetch('/api/dev/users');
      const users = await res.json();
      usersTableBody.innerHTML = '';
      if (!users.length) {
        usersTableBody.innerHTML = '<tr><td colspan="5">Nenhum usuario cadastrado.</td></tr>';
        return;
      }
      users.forEach((user) => {
        const setupLabel = user.role === 'admin'
          ? (Number(user.city_setup_completed) === 1 ? 'Configurada' : 'Primeiro acesso pendente')
          : 'Global';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.role)}<br><small>${setupLabel}</small></td>
          <td>${escapeHtml(user.city_name || '--')}</td>
          <td>${formatDate(user.created_at)}</td>
          <td class="table-actions">
            <button type="button" class="btn btn-danger" data-delete-user="${user.id}" data-username="${escapeHtml(user.username)}">Apagar</button>
          </td>`;
        usersTableBody.appendChild(tr);
      });
      usersTableBody.querySelectorAll('button[data-delete-user]').forEach((button) => {
        button.addEventListener('click', handleDeleteUser);
      });
    } catch (error) {
      console.error(error);
    }
  }

  async function handleDeleteCity(event) {
    const button = event.currentTarget;
    const id = button.getAttribute('data-delete-city');
    const cityName = button.getAttribute('data-city-name') || 'esta cidade';
    const ok = window.confirm(`Apagar ${cityName}? Isso remove usuarios admin, chamados, postes e bairros vinculados a ela.`);
    if (!ok) return;
    try {
      button.disabled = true;
      await authFetch(`/api/dev/cities/${id}`, { method: 'DELETE' });
      await loadCitySelector();
      if (!panelState.citySlug && panelState.cities.length) {
        panelState.citySlug = panelState.cities[0].slug;
      }
      refreshDashboard();
      fetchCities();
      fetchUsers();
      fetchPosts();
    } catch (error) {
      button.disabled = false;
      alert(error.message || 'Erro ao apagar cidade.');
    }
  }

  async function handleDeleteUser(event) {
    const button = event.currentTarget;
    const id = button.getAttribute('data-delete-user');
    const username = button.getAttribute('data-username') || 'este usuario';
    const ok = window.confirm(`Apagar o acesso ${username}?`);
    if (!ok) return;
    try {
      button.disabled = true;
      await authFetch(`/api/dev/users/${id}`, { method: 'DELETE' });
      fetchUsers();
    } catch (error) {
      button.disabled = false;
      alert(error.message || 'Erro ao apagar usuario.');
    }
  }

  async function fetchBranding() {
    if (!brandingForm) return;
    try {
      const res = await authFetch('/api/dev/branding');
      const branding = await res.json();
      if (!branding) return;
      populateBrandingForm(branding);
    } catch (error) {
      console.error(error);
    }
  }

  postForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(postForm).entries());
    body.lat = Number(body.lat);
    body.lng = Number(body.lng);
    try {
      await authFetch('/api/dev/posts', { method: 'POST', body: JSON.stringify(body) });
      postForm.reset();
      fetchPosts();
    } catch (error) {
      alert(error.message || 'Erro ao criar poste.');
    }
  });

  serviceForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(serviceForm).entries());
    try {
      await authFetch('/api/dev/services', { method: 'POST', body: JSON.stringify(body) });
      serviceForm.reset();
      fetchServices();
    } catch (error) {
      alert(error.message || 'Erro ao salvar serviço.');
    }
  });

  brandingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = buildBrandingPayload();
    try {
      await authFetch('/api/dev/branding', { method: 'PATCH', body: JSON.stringify(payload) });
      alert('Briefing atualizado com sucesso.');
    } catch (error) {
      alert(error.message || 'Erro ao atualizar identidade.');
    }
  });

  cityCenterForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveCitySettings(cityCenterForm, cityCenterResult, 'Dados da cidade atualizados.');
    } catch (error) {
      if (cityCenterResult) {
        cityCenterResult.textContent = error.message || 'Erro ao salvar dados da cidade.';
      } else {
        alert(error.message || 'Erro ao salvar dados da cidade.');
      }
    }
  });

  citySetupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveCitySettings(citySetupForm, citySetupResult, 'Cidade configurada com sucesso.');
      refreshDashboard();
    } catch (error) {
      if (citySetupResult) {
        citySetupResult.textContent = error.message || 'Erro ao configurar cidade.';
      } else {
        alert(error.message || 'Erro ao configurar cidade.');
      }
    }
  });

  cityForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(cityForm).entries());
    try {
      await authFetch('/api/dev/cities', { method: 'POST', body: JSON.stringify(body) });
      cityForm.reset();
      await loadCitySelector();
      refreshDashboard();
      fetchCities();
    } catch (error) {
      alert(error.message || 'Erro ao cadastrar cidade.');
    }
  });

  userForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(userForm).entries());
    try {
      await authFetch('/api/dev/users', { method: 'POST', body: JSON.stringify(body) });
      userForm.reset();
      syncUserCityRequirement();
      fetchUsers();
      alert('Usuário criado com sucesso.');
    } catch (error) {
      alert(error.message || 'Erro ao criar usuário.');
    }
  });
});
