'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const money = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});
  const state = {vehicles: [], business: {}, category: '', query: '', sort: 'featured', demo: false};
  let activeDetailButton = null;
  let activeVehicleId = null;
  let catalogFingerprint = null;
  let refreshing = false;
  let loaded = false;
  const add = (parent, tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = String(value);
    parent.append(el);
    return el;
  };
  const text = value => String(value ?? '').trim();
  const rate = vehicle => Number.isFinite(Number(vehicle.rate_amount ?? vehicle.daily_rate)) ? Math.max(0, Number(vehicle.rate_amount ?? vehicle.daily_rate)) : 0;
  const ratePeriod = vehicle => ['daily', 'weekly', 'monthly'].includes(vehicle.rate_period) ? vehicle.rate_period : 'weekly';
  const periodLabel = vehicle => ({daily: 'Diária', weekly: 'Semanal', monthly: 'Mensal'})[ratePeriod(vehicle)];
  const mileageLabel = vehicle => {
    if (vehicle.km_unlimited === true) return 'Quilometragem ilimitada';
    const limit = Number(vehicle.km_limit);
    if (vehicle.km_unlimited === false && Number.isFinite(limit) && limit > 0) {
      const period = {daily: 'diária', weekly: 'semana', monthly: 'período de 30 dias'}[ratePeriod(vehicle)];
      return `Até ${limit.toLocaleString('pt-BR')} km por ${period}`;
    }
    return 'Consulte a franquia';
  };
  const extraKmLabel = vehicle => {
    const value = Number(vehicle.extra_km_rate);
    return Number.isFinite(value) && value > 0 ? `Km excedente: ${money.format(value)}` : '';
  };
  const title = vehicle => text(vehicle.name) || [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Veículo ProCar';
  const photoUrl = value => {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      // Only same-site media belongs in the published fleet.
      if (url.origin !== location.origin) return null;
      return url.href;
    } catch { return null; }
  };
  const photos = vehicle => (Array.isArray(vehicle.photos) ? vehicle.photos : []).map(photoUrl).filter(Boolean);
  const formatPhone = value => {
    let digits = text(value).replace(/\D/g,'');
    if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
    if (digits.length === 11) return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `(${digits.slice(0,2)}) ${digits.slice(2,6)}-${digits.slice(6)}`;
    return text(value);
  };
  const whatsapp = () => text(state.business.whatsapp).replace(/\D/g, '');
  const whatsappUrl = vehicle => {
    const phone = whatsapp();
    if (!/^\d{10,15}$/.test(phone)) return null;
    const message = vehicle
      ? `Olá, ProCar! Tenho interesse no ${title(vehicle)}. Gostaria de consultar disponibilidade e condições de locação. Minhas datas são: `
      : 'Olá, ProCar! Gostaria de consultar a disponibilidade de um veículo e as condições de locação.';
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };
  const statusLabel = vehicle => ({available: 'Disponível para consulta', rented: 'Em locação', maintenance: 'Indisponível no momento'})[vehicle.status] || 'Consulte disponibilidade';
  const normalized = value => text(value).toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const transmissionLabel = vehicle => {
    const transmission = normalized(vehicle.transmission);
    if (transmission === 'manual') return 'Manual';
    if (transmission.startsWith('automat')) return 'Automático';
    return '';
  };
  const isSuv = vehicle => normalized(vehicle.category) === 'suv';
  const categoryLabel = vehicle => isSuv(vehicle) ? 'SUV' : transmissionLabel(vehicle);
  // Body style and transmission can overlap: a manual SUV belongs to both filters.
  const matchesCategory = (vehicle, category) => !category || (category === 'SUV' ? isSuv(vehicle) : transmissionLabel(vehicle) === category);
  const configureContactLink = (link, vehicle, fallbackText) => {
    const unavailable = vehicle && vehicle.status !== 'available';
    link.classList.toggle('is-disabled', Boolean(unavailable));
    link.setAttribute('aria-disabled', String(Boolean(unavailable)));
    if (unavailable) {
      link.removeAttribute('href'); link.removeAttribute('target'); link.removeAttribute('rel');
      link.textContent = vehicle.status === 'rented' ? 'Em locação no momento' : 'Indisponível no momento';
      return;
    }
    const url = whatsappUrl(vehicle);
    if (url) {
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.replaceChildren(document.createTextNode(vehicle ? 'Consultar veículo' : 'Converse pelo WhatsApp'));
      add(link, 'span', '', '↗').setAttribute('aria-hidden', 'true');
    } else {
      link.href = '#contato';
      link.removeAttribute('target');
      link.removeAttribute('rel');
      link.replaceChildren(document.createTextNode(fallbackText));
      add(link, 'span', '', '↗').setAttribute('aria-hidden', 'true');
    }
  };
  const blockIds = {hero:'inicio', fleet:'frota', how:'como-alugar', about:'sobre', faq:'duvidas', contact:'contato'};
  const blockDefaults = new Map();
  Object.entries(blockIds).forEach(([id, domId]) => {const heading = $(domId).querySelector('h1,h2'); blockDefaults.set(id, heading.innerHTML);});
  const renderBlocks = () => {
    const blocks = Array.isArray(state.business.showcase_blocks) ? state.business.showcase_blocks : [];
    const seen = new Set();
    const ordered = [];
    blocks.forEach(block => {if (block && Object.hasOwn(blockIds, block.id) && !seen.has(block.id)) {seen.add(block.id);ordered.push(block);}});
    Object.keys(blockIds).filter(id => !seen.has(id)).forEach(id => ordered.push({id, enabled:true}));
    const main = document.querySelector('main');
    const orderChanged = [...main.querySelectorAll(':scope > section')].map(el => el.id).join(',') !== ordered.map(block => blockIds[block.id]).join(',');
    const focused = document.activeElement;
    ordered.forEach(block => {
      const section = $(blockIds[block.id]);
      section.hidden = block.enabled === false;
      const heading = section.querySelector('h1,h2');
      if (text(block.title)) heading.textContent = text(block.title).slice(0,100);
      else heading.innerHTML = blockDefaults.get(block.id);
      if (orderChanged) main.append(section);
      document.querySelectorAll(`a[href="#${section.id}"]`).forEach(link => {link.hidden = section.hidden;});
    });
    const hero = $('inicio');
    const strip = document.querySelector('.promise-strip');
    strip.hidden = hero.hidden;
    if (hero.nextElementSibling !== strip) hero.after(strip);
    if (orderChanged && focused?.isConnected) focused.focus({preventScroll:true});
  };
  const renderBusiness = () => {
    const b = state.business;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(b.email));
    if (text(b.about)) $('business-about').textContent = b.about;
    const contact = $('business-contact');
    contact.replaceChildren();
    if (text(b.address)) add(contact, 'div', '', b.address);
    if (text(b.phone)) {
      const digits = text(b.phone).replace(/\D/g, '');
      const phone = add(contact, 'a', '', `Telefone: ${formatPhone(b.phone)}`);
      if (/^\d{10,15}$/.test(digits)) phone.href = `tel:+${digits.length <= 11 ? '55' : ''}${digits}`;
    }
    if (validEmail) {
      const email = add(contact, 'a', '', b.email);
      email.href = `mailto:${b.email}`;
    }
    const contactUrl = whatsappUrl();
    if (contactUrl) {
      const phone = add(contact, 'a', '', `WhatsApp: ${formatPhone(whatsapp())}`);
      phone.href = contactUrl;
      phone.target = '_blank';
      phone.rel = 'noopener noreferrer';
      configureContactLink($('contact-whatsapp'), null, 'Encontre seu veículo');
      $('contact-message').textContent = 'Consulte datas, condições e disponibilidade com nossa equipe.';
    } else if (validEmail) {
      $('contact-whatsapp').href = `mailto:${b.email}`;
      $('contact-whatsapp').replaceChildren(document.createTextNode('Converse por e-mail'));
      add($('contact-whatsapp'), 'span', '', '↗');
      $('contact-message').textContent = 'Envie as datas e o modelo desejado para consultar a locação.';
    } else {
      $('contact-whatsapp').href = '#frota';
      $('contact-message').textContent = 'O contato da ProCar será disponibilizado em breve.';
    }
  };
  const specs = vehicle => [text(vehicle.year), text(vehicle.transmission), text(vehicle.fuel), vehicle.seats ? `${vehicle.seats} lugares` : ''].filter(Boolean);
  const renderCard = vehicle => {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-xl-4';
    const article = add(col, 'article', 'vehicle-card');
    const visual = add(article, 'div', 'vehicle-image');
    const vehiclePhotos = state.demo ? [] : photos(vehicle);
    if (vehiclePhotos.length) {
      const img = add(visual, 'img');
      img.src = vehiclePhotos[0];
      img.alt = state.demo ? `Foto ilustrativa de demonstração; não representa necessariamente ${title(vehicle)}` : title(vehicle);
      img.loading = 'lazy';
      img.width = 800;
      img.height = 500;
      img.addEventListener('error', () => {img.remove(); add(visual, 'span', 'vehicle-placeholder', 'ProCar · foto em breve');}, {once: true});
    } else add(visual, 'span', 'vehicle-placeholder', 'ProCar · foto em breve');
    if (categoryLabel(vehicle)) add(visual, 'span', 'vehicle-category', categoryLabel(vehicle));
    if (state.demo) add(visual, 'span', 'vehicle-photo-label', 'Cadastro de demonstração');
    add(visual, 'span', `vehicle-status${vehicle.status === 'available' ? '' : ' unavailable'}`, statusLabel(vehicle));
    const body = add(article, 'div', 'vehicle-body');
    add(body, 'p', 'vehicle-brand', vehicle.brand || 'PROCAR');
    add(body, 'h3', '', title(vehicle));
    const specList = add(body, 'div', 'vehicle-specs');
    specs(vehicle).slice(0, 3).forEach(value => add(specList, 'span', '', value));
    add(body, 'p', 'vehicle-description', text(vehicle.description) || 'Conheça este veículo e consulte as condições com a equipe ProCar.');
    const mileage = add(body, 'div', 'vehicle-mileage');
    add(mileage, 'span', '', mileageLabel(vehicle));
    if (extraKmLabel(vehicle)) add(mileage, 'span', 'vehicle-extra-km', extraKmLabel(vehicle));
    const bottom = add(body, 'div', 'vehicle-bottom');
    const price = add(bottom, 'div', 'vehicle-price');
    add(price, 'strong', '', money.format(rate(vehicle)));
    add(price, 'span', 'price-period', periodLabel(vehicle));
    const button = add(bottom, 'button', 'vehicle-details', '↗');
    button.type = 'button';
    button.dataset.vehicleId = String(vehicle.id);
    button.setAttribute('aria-label', `Ver detalhes de ${title(vehicle)}`);
    button.addEventListener('click', () => openDetails(vehicle, button));
    return col;
  };
  const renderCatalog = () => {
    const focusedVehicle = document.activeElement?.dataset?.vehicleId;
    const query = state.query.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let vehicles = state.vehicles.filter(vehicle => matchesCategory(vehicle, state.category) &&
      [title(vehicle), vehicle.brand, vehicle.model, categoryLabel(vehicle), transmissionLabel(vehicle)].join(' ').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(query));
    vehicles = [...vehicles];
    if (state.sort === 'price-asc') vehicles.sort((a,b) => rate(a)-rate(b));
    if (state.sort === 'price-desc') vehicles.sort((a,b) => rate(b)-rate(a));
    if (state.sort === 'name') vehicles.sort((a,b) => title(a).localeCompare(title(b), 'pt-BR'));
    $('vehicle-grid').replaceChildren(...vehicles.map(renderCard));
    if (focusedVehicle) [...$('vehicle-grid').querySelectorAll('[data-vehicle-id]')].find(el => el.dataset.vehicleId === focusedVehicle)?.focus({preventScroll:true});
    $('vehicle-grid').setAttribute('aria-busy', 'false');
    $('catalog-count').textContent = `${vehicles.length} ${vehicles.length === 1 ? 'veículo encontrado' : 'veículos encontrados'}${state.demo ? ' · catálogo de demonstração' : ''}`;
    $('catalog-state').hidden = vehicles.length > 0;
    $('catalog-state').textContent = state.vehicles.length ? 'Nenhum veículo corresponde à sua busca. Experimente outra categoria ou modelo.' : 'Nossa frota será disponibilizada em breve. Fale com a ProCar para consultar as opções.';
  };
  const renderFilters = () => {
    const filters = $('category-filters');
    const categories = ['Manual', 'Automático', 'SUV'];
    for (const category of categories) {
      const button = add(filters, 'button', 'category-button', category);
      button.type = 'button';
      button.dataset.category = category;
      button.setAttribute('aria-pressed','false');
    }
    filters.addEventListener('click', event => {
      const button = event.target.closest('button[data-category]');
      if (!button) return;
      state.category = button.dataset.category;
      filters.querySelectorAll('button').forEach(item => {item.classList.toggle('active',item === button);item.setAttribute('aria-pressed',String(item === button));});
      renderCatalog();
    });
  };
  const openDetails = (vehicle, trigger) => {
    activeDetailButton = trigger;
    activeVehicleId = vehicle.id;
    $('detail-name').textContent = title(vehicle);
    $('detail-category').textContent = `${categoryLabel(vehicle) || 'PROCAR'}${state.demo ? ' · DEMONSTRAÇÃO' : ''}`;
    $('detail-description').textContent = text(vehicle.description) || 'Consulte a equipe ProCar para conhecer as características e as condições de locação deste veículo.';
    $('detail-specs').replaceChildren();
    specs(vehicle).forEach(value => add($('detail-specs'),'span','',value));
    $('detail-price').textContent = money.format(rate(vehicle));
    $('detail-period').textContent = periodLabel(vehicle);
    $('detail-mileage').textContent = mileageLabel(vehicle);
    $('detail-extra-km').textContent = extraKmLabel(vehicle);
    $('detail-extra-km').hidden = !extraKmLabel(vehicle);
    $('detail-period-note').textContent = {
      daily: 'Plano diário: preço referente a uma diária. Confirme o período e o valor total com a equipe.',
      weekly: 'Plano semanal: preço referente a um período de 7 dias. Confirme o período e o valor total com a equipe.',
      monthly: 'Plano mensal: preço referente a um período de 30 dias corridos. Confirme o período e o valor total com a equipe.',
    }[ratePeriod(vehicle)];
    $('detail-availability').textContent = statusLabel(vehicle);
    const items = state.demo ? [] : photos(vehicle);
    $('detail-image').src = items[0] || 'assets/mobility.svg';
    $('detail-image').alt = items.length && !state.demo ? title(vehicle) : 'Ilustração genérica. Fotografia deste veículo ainda não cadastrada.';
    $('detail-image').onerror = () => {$('detail-image').onerror = null; $('detail-image').src = 'assets/mobility.svg'; $('detail-image').alt = 'Ilustração genérica. Fotografia deste veículo indisponível.';};
    $('detail-thumbnails').replaceChildren();
    if (items.length > 1) items.forEach((url, index) => {
      const button = add($('detail-thumbnails'),'button', index === 0 ? 'active' : '');
      button.type = 'button';
      button.setAttribute('aria-label',`Ver foto ${index + 1} de ${title(vehicle)}`);
      button.setAttribute('aria-pressed', String(index === 0));
      const img = add(button, 'img'); img.src = url; img.alt = ''; img.loading = 'lazy';
      button.addEventListener('click', () => {
        $('detail-image').src = url;
        $('detail-thumbnails').querySelectorAll('button').forEach(item => {item.classList.toggle('active',item === button);item.setAttribute('aria-pressed',String(item === button));});
      });
    });
    configureContactLink($('detail-whatsapp'), vehicle, 'Ver opções de contato');
    $('vehicle-dialog').showModal();
    document.body.classList.add('dialog-open');
    $('detail-close').focus();
  };
  const closeDetails = () => $('vehicle-dialog').close();
  $('detail-close').addEventListener('click',closeDetails);
  $('vehicle-dialog').addEventListener('click', event => {if (event.target === $('vehicle-dialog')) {const rect = event.target.getBoundingClientRect(); if(event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetails();}});
  $('vehicle-dialog').addEventListener('close', () => {document.body.classList.remove('dialog-open'); const trigger = [...$('vehicle-grid').querySelectorAll('[data-vehicle-id]')].find(el => el.dataset.vehicleId === String(activeVehicleId)); (trigger || (activeDetailButton?.isConnected && activeDetailButton) || $('vehicle-search')).focus({preventScroll:true}); activeVehicleId = null;});
  $('detail-whatsapp').addEventListener('click', () => {if (!$('detail-whatsapp').hasAttribute('target')) closeDetails();});
  $('vehicle-search').addEventListener('input', event => {state.query = event.target.value;renderCatalog();});
  $('vehicle-sort').addEventListener('change', event => {state.sort = event.target.value;renderCatalog();});
  $('nav-toggle').addEventListener('click', () => {
    const open = $('navigation').classList.toggle('open');
    $('nav-toggle').setAttribute('aria-expanded',String(open));
    $('nav-toggle').setAttribute('aria-label',open ? 'Fechar menu' : 'Abrir menu');
  });
  $('navigation').addEventListener('click', event => {if(event.target.closest('a')) {$('navigation').classList.remove('open');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-toggle').setAttribute('aria-label','Abrir menu');}});
  $('year').textContent = new Date().getFullYear();
  renderFilters();
  const refreshCatalog = async () => {
    if (refreshing || document.hidden) return;
    refreshing = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('catalog.json', {cache:'no-cache', signal:controller.signal});
      if (!response.ok) throw new Error('Catálogo indisponível');
      const catalog = await response.json();
      if (!catalog || !Array.isArray(catalog.vehicles)) throw new Error('Catálogo inválido');
      const fingerprint = JSON.stringify(catalog);
      if (fingerprint === catalogFingerprint) return;
      catalogFingerprint = fingerprint;
      state.vehicles = catalog.vehicles.filter(vehicle => vehicle && typeof vehicle === 'object' && vehicle.published !== false);
      state.business = catalog.business && typeof catalog.business === 'object' ? catalog.business : {};
      state.demo = catalog.demo === true;
      $('demo-banner').hidden = !state.demo;
      if (catalog.updated_at) {const date = new Date(catalog.updated_at); if (!Number.isNaN(date.getTime())) $('catalog-updated').textContent = `Catálogo atualizado em ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`;}
      renderBusiness(); renderBlocks(); renderCatalog(); loaded = true;
      // Update availability in place: keep the visitor's open gallery and focus.
      if ($('vehicle-dialog').open) {
        const vehicle = state.vehicles.find(item => item.id === activeVehicleId);
        $('detail-availability').textContent = vehicle ? statusLabel(vehicle) : 'Veículo retirado da vitrine';
        configureContactLink($('detail-whatsapp'), vehicle || {status:'unavailable'}, 'Ver opções de contato');
        if (vehicle) {
          $('detail-price').textContent = money.format(rate(vehicle));
          $('detail-period').textContent = periodLabel(vehicle);
          $('detail-mileage').textContent = mileageLabel(vehicle);
          $('detail-extra-km').textContent = extraKmLabel(vehicle);
          $('detail-extra-km').hidden = !extraKmLabel(vehicle);
        }
      }
    } catch {
      if (!loaded) {
        $('vehicle-grid').setAttribute('aria-busy','false');
        $('catalog-count').textContent = 'Aguardando conexão com o catálogo';
        $('catalog-state').hidden = false;
        $('catalog-state').textContent = location.protocol === 'file:' ? 'Abra a vitrine pelo painel ProCar ou por um servidor HTTP para carregar o catálogo.' : 'Não foi possível carregar os veículos agora. A atualização será tentada automaticamente. Você também pode falar com a ProCar pelo contato abaixo.';
      }
    } finally {clearTimeout(timeout); refreshing = false;}
  };
  refreshCatalog();
  setInterval(refreshCatalog, 30000);
  document.addEventListener('visibilitychange', () => {if (!document.hidden) refreshCatalog();});
  window.addEventListener('online', refreshCatalog);
  document.addEventListener('keydown', event => {if (event.key === 'Escape' && $('navigation').classList.contains('open')) {$('navigation').classList.remove('open');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-toggle').setAttribute('aria-label','Abrir menu');$('nav-toggle').focus();}});
})();
