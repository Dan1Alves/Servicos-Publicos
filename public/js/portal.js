const state = {
  city: null,
  posts: [],
  selectedPost: null,
  coords: null,
  branding: null,
  activeService: null,
  citySlugFromPath: null,
  autoOpenService: null
};

const SERVICE_FLOW = [
  {
    slug: 'iluminacao-publica',
    name: 'Iluminação Pública',
    description: 'Postes, lâmpadas e rede elétrica municipal.'
  },
  {
    slug: 'buracos-na-rua',
    name: 'Buracos na Rua',
    description: 'Chamados de tapa-buraco e pavimentação (em breve).'
  },
  {
    slug: 'lixo-acumulado',
    name: 'Lixo Acumulado',
    description: 'Resíduos sólidos e pontos críticos de descarte (em breve).'
  }
];

const MAP_DEFAULT = { lat: -14.235004, lng: -51.92528, zoom: 4 };
const MAP_DEFAULT_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
let mapStyleUrl = MAP_DEFAULT_STYLE;

let mapInstance = null;
let mapReady = false;
let markerRefs = [];
let userMarker = null;
let pendingUserCoords = null;

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value ?? '';
  }
}

function updateInlineSummary() {
  const inlineLabel = document.getElementById('selectedPostInline');
  const helper = document.getElementById('inlineHelper');
  if (!inlineLabel || !helper) return;
  const inlineTitle = document.getElementById('inlineTitle');
  if (inlineTitle) {
    inlineTitle.textContent = state.branding?.inlineCardTitle || 'Poste selecionado';
  }
  const emptyMessage = state.branding?.inlineEmptyText || 'Nenhum poste selecionado';
  const defaultHelper = state.branding?.inlineHelperText || 'Escolha um poste no mapa e clique em "Preencher denúncia".';
  if (!state.activeService) {
    inlineLabel.textContent = 'Selecione um serviço institucional';
    helper.textContent = 'Use o modal inicial para habilitar o mapa e registrar denúncias.';
    return;
  }
  if (state.selectedPost) {
    const address = [state.selectedPost.rua, state.selectedPost.bairro].filter(Boolean).join(', ') || 'Sem endereço informado';
    inlineLabel.textContent = `${state.selectedPost.post_uid} • ${address}`;
    helper.textContent = 'Dados do poste serão preenchidos automaticamente no formulário.';
  } else {
    inlineLabel.textContent = emptyMessage;
    helper.textContent = defaultHelper;
  }
}

function attemptReportFlow() {
  if (!state.activeService) {
    document.getElementById('serviceModal').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (!state.selectedPost) {
    openDrawerMessage('Selecione um poste no mapa para continuar.');
    return;
  }
  openModal();
}

function applyBranding(branding) {
  if (!branding) return;
  state.branding = branding;
  setText('brandName', state.city?.name || branding.organization || 'Gestão Urbana');
  setText('heroTitle', branding.heroTitle || 'Gestão Urbana Integrada');
  setText('heroSubtitle', branding.heroSubtitle || 'Monitoramento institucional.');
  setText('heroCity', state.city?.name || branding.cityName || branding.organization || 'Cidade Modelo');
  setText('serviceModalTitle', branding.serviceModalTitle || 'Escolha um serviço para iniciar');
  setText('serviceModalSubtitle', branding.serviceModalSubtitle || 'Somente Iluminação Pública está liberada. Os demais módulos chegarão em breve.');

  const aboutParagraph = document.querySelector('#aboutText p');
  if (aboutParagraph) {
    aboutParagraph.textContent = branding.aboutText || aboutParagraph.textContent;
  }
  const institutionalParagraph = document.querySelector('#institutionalText p');
  if (institutionalParagraph) {
    institutionalParagraph.textContent = branding.transparencyText || institutionalParagraph.textContent;
  }

  const contactParts = [];
  if (branding.organization) contactParts.push(branding.organization);
  if (branding.contact?.email) contactParts.push(branding.contact.email);
  if (branding.contact?.phone) contactParts.push(branding.contact.phone);
  if (branding.contact?.whatsapp) contactParts.push(branding.contact.whatsapp);
  const footerText = branding.footerNote || (contactParts.length ? contactParts.join(' • ') : null);
  if (footerText) {
    setText('contactInfo', footerText);
  }

  const root = document.documentElement;
  if (branding.primaryColor) root.style.setProperty('--primary', branding.primaryColor);
  if (branding.secondaryColor) root.style.setProperty('--secondary', branding.secondaryColor);
  if (branding.accentColor) root.style.setProperty('--accent', branding.accentColor);
  if (branding.cardBackground) root.style.setProperty('--card-background', branding.cardBackground);
  if (branding.cardBorderColor) root.style.setProperty('--card-border', branding.cardBorderColor);
  if (branding.serviceModalBackground) root.style.setProperty('--service-modal-card', branding.serviceModalBackground);
  if (branding.serviceModalOverlay) root.style.setProperty('--service-modal-overlay', branding.serviceModalOverlay);
  if (branding.serviceModalBorderColor) root.style.setProperty('--service-modal-border', branding.serviceModalBorderColor);
  if (branding.inlineCardBackground) root.style.setProperty('--inline-card-bg', branding.inlineCardBackground);
  if (branding.inlineCardBorder) root.style.setProperty('--inline-card-border', branding.inlineCardBorder);
  if (branding.inlineCardTextColor) root.style.setProperty('--inline-card-text', branding.inlineCardTextColor);
  if (branding.inlineCardMutedColor) root.style.setProperty('--inline-card-muted', branding.inlineCardMutedColor);
  if (branding.inlineCardButtonBorder) root.style.setProperty('--inline-card-button', branding.inlineCardButtonBorder);
  if (branding.drawerBackground) root.style.setProperty('--drawer-bg', branding.drawerBackground);
  if (branding.drawerTextColor) root.style.setProperty('--drawer-color', branding.drawerTextColor);
  if (branding.modalBackground) root.style.setProperty('--modal-bg', branding.modalBackground);
  if (branding.modalTextColor) root.style.setProperty('--modal-color', branding.modalTextColor);
  if (branding.pageBackground) {
    root.style.setProperty('--surface', branding.pageBackground);
    document.body.style.background = branding.pageBackground;
  }

  const heroSection = document.getElementById('mapSection');
  if (heroSection) {
    if (branding.heroBackground) {
      heroSection.style.background = branding.heroBackground;
    } else {
      heroSection.style.background = '';
    }
    if (branding.heroImage) {
      heroSection.style.backgroundImage = `linear-gradient(135deg, rgba(5, 12, 24, 0.85), rgba(5, 12, 24, 0.45)), url(${branding.heroImage})`;
      heroSection.style.backgroundSize = 'cover';
      heroSection.style.backgroundPosition = 'center';
    } else if (!branding.heroBackground) {
      heroSection.style.backgroundImage = '';
    }
  }

  setText('inlineTitle', branding.inlineCardTitle || 'Poste selecionado');
  const inlineHelper = document.getElementById('inlineHelper');
  if (inlineHelper && branding.inlineHelperText) {
    inlineHelper.textContent = branding.inlineHelperText;
  }
  const inlineButton = document.getElementById('openReportInline');
  const ctaLabel = branding.inlineButtonText || branding.heroCta?.text;
  if (inlineButton && ctaLabel) {
    inlineButton.textContent = ctaLabel;
  }
  const drawerTip = document.getElementById('drawerTip');
  if (drawerTip && branding.drawerTipText) {
    drawerTip.textContent = branding.drawerTipText;
  }
  setText('reportModalTitle', branding.reportModalTitle || 'Registrar iluminação pública');
  setText('reportModalDescription', branding.reportModalDescription || 'Selecione um poste no mapa para preencher os dados automaticamente.');
  const submitButton = document.getElementById('reportSubmitButton');
  if (submitButton) {
    submitButton.textContent = branding.reportSubmitLabel || 'Enviar denúncia';
  }

  const nextStyle = branding.mapStyleUrl || MAP_DEFAULT_STYLE;
  if (nextStyle !== mapStyleUrl) {
    mapStyleUrl = nextStyle;
    if (mapInstance) {
      mapInstance.setStyle(mapStyleUrl);
    }
  }

  updateInlineSummary();
}

function initMap() {
  if (typeof maplibregl === 'undefined') {
    console.warn('MapLibre não carregado.');
    return;
  }
  const initialView = getInitialMapView();
  mapInstance = new maplibregl.Map({
    container: 'map',
    style: mapStyleUrl,
    center: [initialView.lng, initialView.lat],
    zoom: initialView.zoom,
    attributionControl: true
  });
  mapInstance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
  mapInstance.on('load', () => {
    mapReady = true;
    centerOnCity();
    if (pendingUserCoords) {
      const { lat, lng } = pendingUserCoords;
      pendingUserCoords = null;
      setUserMarker(lat, lng);
    }
  });
}

function getInitialMapView() {
  const lat = Number(state.city?.default_lat);
  const lng = Number(state.city?.default_lng);
  const zoom = Number(state.city?.default_zoom);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      lat,
      lng,
      zoom: Number.isFinite(zoom) ? zoom : MAP_DEFAULT.zoom
    };
  }
  return MAP_DEFAULT;
}

function centerOnCity() {
  if (!mapInstance || !state.city) return;
  const view = getInitialMapView();
  const center = [view.lng, view.lat];
  const zoom = view.zoom;
  if (mapReady) {
    mapInstance.jumpTo({ center, zoom });
  } else {
    mapInstance.once('load', () => mapInstance.jumpTo({ center, zoom }));
  }
}

function syncStatBlocks(values) {
  setText('statTotal', values.total);
  setText('statOpen', values.open);
  setText('statProgress', values.progress);
  setText('statClosed', values.closed);

  setText('statTotalCard', values.total);
  setText('statOpenCard', values.open);
  setText('statProgressCard', values.progress);
  setText('statClosedCard', values.closed);
  setText('statSla', values.sla);
}

function formatDate(iso) {
  if (!iso) return '--';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(iso));
  } catch (_) {
    return iso;
  }
}

function clearMarkers() {
  markerRefs.forEach(marker => marker.remove());
  markerRefs = [];
}

function createPostMarkerElement(post) {
  const wrapper = document.createElement('div');
  wrapper.className = 'post-marker';
  wrapper.innerHTML = `
    <span class="post-marker-badge" aria-hidden="true">
      <img src="/img/poste.svg" alt="Poste público" loading="lazy" />
    </span>
    <span class="post-marker-tail"></span>`;
  wrapper.title = post.post_uid || 'Poste';
  wrapper.addEventListener('click', () => openDrawer(post));
  return wrapper;
}

function addMarker(post) {
  if (!mapInstance || typeof post.lat !== 'number' || typeof post.lng !== 'number') return;
  const element = createPostMarkerElement(post);
  const marker = new maplibregl.Marker({ element, anchor: 'bottom' })
    .setLngLat([post.lng, post.lat])
    .addTo(mapInstance);
  markerRefs.push(marker);
}

function openDrawer(post) {
  state.selectedPost = post;
  setText('drawerPostId', post.post_uid || `Poste ${post.id}`);
  const address = [post.rua, post.bairro].filter(Boolean).join(' • ') || 'Endereço não informado';
  setText('drawerPostAddress', address);
  setText('reportPostSummary', `Poste ${post.post_uid} — ${address}`);
  const postField = document.getElementById('reportPostId');
  if (postField) postField.value = post.id;
  document.getElementById('postDrawer').classList.add('open');
  setText('reportResult', '');
  updateInlineSummary();
}

function closeDrawer() {
  document.getElementById('postDrawer').classList.remove('open');
}

function openDrawerMessage(message) {
  setText('drawerPostAddress', message);
  document.getElementById('postDrawer').classList.add('open');
}

function selectService(service, options = {}) {
  if (!service) return;
  const shouldScroll = options.scroll !== false;
  state.activeService = service;
  setText('selectedServiceLabel', `${service.name} ativo. Localize o poste e toque em "Reportar problema".`);
  document.getElementById('serviceModal').classList.add('hidden');
  const mapSection = document.getElementById('mapSection');
  mapSection.classList.remove('hidden');
  const hiddenField = document.getElementById('reportServiceSlug');
  if (hiddenField) hiddenField.value = service.slug;
  requestAnimationFrame(() => {
    mapInstance?.resize();
    centerOnCity();
  });
  loadPosts();
  if (shouldScroll) {
    mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  updateInlineSummary();
}

async function loadPosts() {
  clearMarkers();
  state.selectedPost = null;
  if (!state.activeService || state.activeService.slug !== 'iluminacao-publica') {
    updateInlineSummary();
    return;
  }
  try {
    const slug = state.city?.slug ? encodeURIComponent(state.city.slug) : '';
    const res = await fetch(`/api/public/posts?city=${slug}`);
    const data = await res.json();
    state.posts = data.posts || [];
    if (!state.posts.length) {
      setText('selectedServiceLabel', 'Ainda não há postes cadastrados para esta cidade.');
      return;
    }
    state.posts.forEach(addMarker);
  } catch (error) {
    console.error('Erro ao carregar postes', error);
    setText('selectedServiceLabel', 'Não foi possível carregar os postes agora.');
  }
  updateInlineSummary();
}

async function loadStatistics() {
  try {
    const slug = state.city?.slug ? encodeURIComponent(state.city.slug) : '';
    const res = await fetch(`/api/public/statistics?city=${slug}`);
    const data = await res.json();
    const totals = {
      total: data.totalReports ?? '--',
      open: data.status?.aberto ?? 0,
      progress: data.status?.em_andamento ?? 0,
      closed: data.status?.resolvido ?? 0,
      sla: data.averageResolutionMinutes ?? '--'
    };
    syncStatBlocks(totals);
    renderHotspots(data.hotspots || []);
    renderProtocols(data.recentProtocols || []);
  } catch (error) {
    console.error('Erro ao carregar indicadores públicos', error);
  }
}

function renderHotspots(rows) {
  const list = document.getElementById('hotspotList');
  if (!list) return;
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = 'Nenhum bairro com concentração relevante.';
    list.appendChild(li);
    return;
  }
  rows.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${item.bairro || 'Sem registro'}</strong><br/><small>${item.total} chamados</small>`;
    list.appendChild(li);
  });
}

function renderProtocols(rows) {
  const list = document.getElementById('protocolList');
  if (!list) return;
  list.innerHTML = '';
  if (!rows.length) {
    const li = document.createElement('li');
    li.textContent = 'Ainda não há protocolos públicos exibidos.';
    list.appendChild(li);
    return;
  }
  rows.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${item.protocol}</strong><br/><small>${item.status || '--'} • ${formatDate(item.created_at)}</small>`;
    list.appendChild(li);
  });
}

function setLocationStatus(message, isPersistent = false) {
  const el = document.getElementById('locationStatus');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('visible', Boolean(message));
  if (message && !isPersistent) {
    window.setTimeout(() => {
      el.textContent = '';
      el.classList.remove('visible');
    }, 3500);
  }
}

function locateUser() {
  if (!navigator.geolocation || !mapInstance) {
    setLocationStatus('GPS indisponível neste navegador.');
    return;
  }
  setLocationStatus('Localizando...', true);
  const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
  navigator.geolocation.getCurrentPosition(
    (position) => {
      updateUserLocation(position, true);
      setLocationStatus('Localização encontrada.');
    },
    () => setLocationStatus('Não foi possível obter sua localização.'),
    options
  );
}

function updateUserLocation(position, shouldFly) {
  state.coords = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };
  setUserMarker(state.coords.lat, state.coords.lng);
  if (shouldFly && mapInstance) {
    mapInstance.flyTo({ center: [state.coords.lng, state.coords.lat], zoom: 15, speed: 0.8 });
  }
}

function createUserMarkerElement() {
  const wrapper = document.createElement('div');
  wrapper.className = 'user-marker';
  wrapper.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5z"/>
    </svg>`;
  return wrapper;
}

function setUserMarker(lat, lng) {
  if (!mapInstance || typeof maplibregl === 'undefined') {
    pendingUserCoords = { lat, lng };
    return;
  }
  pendingUserCoords = null;
  if (!userMarker) {
    const element = createUserMarkerElement();
    userMarker = new maplibregl.Marker({ element, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(mapInstance);
  } else {
    userMarker.setLngLat([lng, lat]);
  }
}

function renderServiceSelector(servicesFromApi) {
  const container = document.getElementById('serviceCards');
  if (!container) return;
  const serviceMap = {};
  (servicesFromApi || []).forEach(service => {
    if (service.slug) serviceMap[service.slug] = service;
  });
  container.innerHTML = '';
  SERVICE_FLOW.forEach(meta => {
    const info = { ...meta, ...(serviceMap[meta.slug] || {}) };
    const isLighting = info.slug === 'iluminacao-publica';
    const status = isLighting ? 'active' : 'upcoming';
    const button = document.createElement('button');
    button.className = isLighting ? 'btn btn-primary' : 'btn btn-outline';
    button.textContent = isLighting ? 'Selecionar serviço' : 'Disponível em breve';
    button.disabled = !isLighting;
    if (isLighting) {
      button.addEventListener('click', () => selectService(info));
    }

    const card = document.createElement('article');
    card.className = `service-card ${!isLighting ? 'disabled' : ''}`.trim();
    card.innerHTML = `
      <div>
        <h3>${info.name}</h3>
        <p>${info.description || ''}</p>
        <div class="status status-${status}">${isLighting ? 'Disponível' : 'Em breve'}</div>
      </div>`;
    card.appendChild(button);
    container.appendChild(card);
  });
}

function pickCityFromQuery(cities) {
  try {
    const params = new URLSearchParams(window.location.search);
    const slugFromUrl = params.get('city');
    if (!slugFromUrl || !cities?.length) return null;
    const normalized = slugFromUrl.toLowerCase();
    return cities.find(city => city.slug.toLowerCase() === normalized) || null;
  } catch (_) {
    return null;
  }
}

function getCitySlugFromPath() {
  const rawPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (!rawPath || rawPath.includes('/')) return null;
  const normalized = decodeURIComponent(rawPath).toLowerCase();
  const reserved = new Set(['api', 'uploads', 'css', 'js', 'img', 'login', 'painel', 'contato']);
  if (reserved.has(normalized) || normalized.includes('.')) return null;
  return normalized;
}

function pickCityFromPath(cities) {
  const slug = getCitySlugFromPath();
  state.citySlugFromPath = slug;
  if (!slug || !cities?.length) return null;
  return cities.find(city => city.slug.toLowerCase() === slug) || null;
}

function pickDefaultService(services) {
  const list = services || [];
  return list.find(service => service.slug === 'iluminacao-publica' && service.status === 'active')
    || list.find(service => service.status === 'active')
    || null;
}

function updateCityLinks() {
  if (!state.city?.slug) return;
  const cityPath = `/${state.city.slug}`;
  document.querySelectorAll('a[href="/"]').forEach(link => {
    link.href = cityPath;
  });
}

async function loadConfig() {
  try {
    const res = await fetch('/api/public/config');
    const data = await res.json();
    const cityFromPath = pickCityFromPath(data.cities);
    const cityFromQuery = pickCityFromQuery(data.cities);
    state.city = cityFromPath || cityFromQuery || data.defaultCity || data.cities?.[0] || null;
    applyBranding(data.branding);
    updateCityLinks();
    renderServiceSelector(data.services || []);
    state.autoOpenService = cityFromPath ? pickDefaultService(data.services) : null;
    setText(
      'selectedServiceLabel',
      state.autoOpenService ? 'Mapa carregado para a cidade selecionada.' : 'Selecione o serviço para liberar o mapa.'
    );
    await loadStatistics();
    updateInlineSummary();
  } catch (error) {
    console.error('Erro ao carregar configuração pública', error);
  }
}

function setupInteractions() {
  document.getElementById('drawerReportButton').addEventListener('click', attemptReportFlow);
  const heroButton = document.getElementById('openReportFromHero');
  heroButton?.addEventListener('click', attemptReportFlow);
  const inlineBtn = document.getElementById('openReportInline');
  inlineBtn?.addEventListener('click', attemptReportFlow);
  const locateButton = document.getElementById('locateUserButton');
  locateButton?.addEventListener('click', locateUser);

  document.getElementById('closeDrawer').addEventListener('click', closeDrawer);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('reportModal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) {
      closeModal();
    }
  });

  const reportForm = document.getElementById('reportForm');
  reportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = document.getElementById('reportResult');
    if (!state.activeService) {
      result.textContent = 'Selecione um serviço antes de registrar.';
      return;
    }
    if (!state.selectedPost) {
      result.textContent = 'Selecione um poste no mapa antes de enviar.';
      return;
    }
    const formData = new FormData(reportForm);
    formData.set('service_slug', state.activeService.slug);
    formData.set('post_id', state.selectedPost.id);
    formData.set('browser_lat', state.coords?.lat || '');
    formData.set('browser_lng', state.coords?.lng || '');
    result.textContent = 'Enviando...';
    try {
      const res = await fetch('/api/report', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao registrar a denúncia.');
      result.innerHTML = `Chamado registrado. Protocolo <strong>${data.protocol}</strong>`;
      reportForm.reset();
    } catch (error) {
      result.textContent = error.message;
    }
  });
}

function openModal() {
  const modal = document.getElementById('reportModal');
  if (!modal) return;
  if (!state.selectedPost) {
    openDrawerMessage('Selecione um poste no mapa para continuar.');
    return;
  }
  document.getElementById('reportLat').value = state.coords?.lat || '';
  document.getElementById('reportLng').value = state.coords?.lng || '';
  modal.classList.add('active');
}

function closeModal() {
  document.getElementById('reportModal').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', async () => {
  setupInteractions();
  await loadConfig();
  initMap();
  if (state.autoOpenService) {
    selectService(state.autoOpenService, { scroll: false });
  }
});
