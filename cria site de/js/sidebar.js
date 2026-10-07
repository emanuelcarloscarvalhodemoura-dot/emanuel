import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const body = document.body;
if (!body.classList.contains('dashboard-page')) throw new Error('Sidebar disponível apenas nas áreas autenticadas.');
const header = document.querySelector('.dashboard-header');
const main = document.querySelector('main.dashboard');
if (!header || !main) throw new Error('Estrutura do painel X-EDU+ não encontrada.');

function prepareAnchors() {
  const welcome = main.querySelector('.dashboard-welcome');
  if (welcome && !welcome.id) welcome.id = 'page-top';
  const avatar = welcome?.querySelector('.user-avatar');
  if (avatar && !avatar.id) avatar.id = 'profile';
  const stats = document.querySelector('.admin-stats');
  if (stats && !stats.id) stats.id = 'admin-stats';
  const users = document.querySelector('.admin-section');
  if (users && !users.id) users.id = 'admin-users';
}

function menuFor(role) {
  if (role === 'aluno') return [
    { icon: '🏠', label: 'Home', href: '#page-top' },
    { icon: '📚', label: 'Meus cursos', href: '#student-courses' },
    { icon: '📝', label: 'Atividades', href: '#student-pending-activities' },
    { icon: '✅', label: 'Correções', href: '#student-corrections' },
    { icon: '🏆', label: 'Ranking', href: '#student-ranking' },
    { icon: '💬', label: 'Fórum de Dúvidas', href: 'forum.html' },
    { icon: '👤', label: 'Perfil', href: '#profile', footer: true }
  ];
  if (role === 'professor') return [
    { icon: '🏠', label: 'Home', href: '#page-top' },
    { icon: '📚', label: 'Meus cursos', href: '#teacher-courses' },
    { icon: '➕', label: 'Criar curso', href: '#course-form' },
    { icon: '📝', label: 'Atividades', href: '#teacher-courses' },
    { icon: '✅', label: 'Correções', href: '#teacher-courses' },
    { icon: '👥', label: 'Alunos', href: '#teacher-students-section' },
    { icon: '📊', label: 'Resultados', href: '#teacher-results-section' },
    { icon: '💬', label: 'Fórum de Dúvidas', href: 'forum.html' },
    { icon: '👤', label: 'Perfil', href: '#profile', footer: true }
  ];
  if (role === 'admin') return [
    { icon: '🏠', label: 'Dashboard', href: '#page-top' },
    { icon: '👥', label: 'Usuários', href: '#admin-users' },
    { icon: '👨‍🏫', label: 'Professores', href: '#admin-users', filter: 'professores' },
    { icon: '👨‍🎓', label: 'Alunos', href: '#admin-users', filter: 'alunos' },
    { icon: '📚', label: 'Cursos', href: '#admin-courses' },
    { icon: '📝', label: 'Atividades', href: '#admin-activities' },
    { icon: '📊', label: 'Análises', href: '#admin-overview' },
    { icon: '🏆', label: 'Ranking', href: '#admin-ranking' },
    { icon: '💬', label: 'Fórum', href: '#admin-forum' },
    { icon: '⚙️', label: 'Configurações', href: '#admin-settings' },
    { icon: '👤', label: 'Perfil', href: '#profile', footer: true }
  ];
  return [];
}

function renderSidebar(role, profile, user) {
  prepareAnchors();
  const items = menuFor(role);
  const isForumPage = /\/forum\.html$/.test(location.pathname);
  const dashboardPage = role === 'admin' ? 'admin.html' : role === 'professor' ? 'professor.html' : 'aluno.html';
  if (isForumPage) {
    items.forEach((item) => {
      if (item.href.startsWith('#')) item.href = `${dashboardPage}${item.href}`;
    });
  }
  const roleName = { aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' }[role] || 'X-EDU+';
  const userName = profile?.nome || user.displayName || roleName;
  const initial = (userName.trim().charAt(0) || 'E').toLocaleUpperCase('pt-BR');
  const photoURL = profile?.profileAvatar ? '' : (profile?.profilePhoto || user.photoURL || '');
  const avatarFallback = ({ rapaz1: '👨🏻‍🎓', rapaz2: '👨🏽‍💻', rapaz3: '👨🏾‍🔬', moca1: '👩🏻‍🎓', moca2: '👩🏽‍💻', moca3: '👩🏾‍🔬' })[profile?.profileAvatar] || initial;
  const primary = items.filter((item) => !item.footer);
  const footerItem = items.find((item) => item.footer);
  if (footerItem && footerItem.href.startsWith('#') && !document.getElementById(footerItem.href.slice(1))) footerItem.href = '#sidebar-user-card';
  const aside = document.createElement('aside');
  aside.className = 'app-sidebar';
  aside.id = 'app-sidebar';
  aside.setAttribute('aria-label', `Menu principal — ${roleName}`);
  aside.innerHTML = `<a class="sidebar-brand" href="${role === 'admin' ? 'admin.html' : role === 'professor' ? 'professor.html' : 'aluno.html'}" aria-label="X-EDU+ — início"><span class="brand-mark">X</span><span>X-EDU<span class="brand-accent">+</span></span></a><div class="sidebar-role-label">${role === 'admin' ? 'ADMINISTRAÇÃO' : `ÁREA DO ${roleName.toLocaleUpperCase('pt-BR')}`}</div><nav class="sidebar-nav" aria-label="Navegação do painel">${primary.map((item) => `<a class="sidebar-item" href="${item.href}" ${item.filter ? `data-sidebar-filter="${item.filter}"` : ''}><span class="sidebar-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></a>`).join('')}</nav><div class="sidebar-bottom">${footerItem ? `<a class="sidebar-item sidebar-profile-link" href="${footerItem.href}"><span class="sidebar-icon" aria-hidden="true">${footerItem.icon}</span><span>${footerItem.label}</span></a>` : ''}<div class="sidebar-user" id="sidebar-user-card"><span class="sidebar-avatar">${photoURL ? `<img src="${escapeHTML(photoURL)}" alt="">` : escapeHTML(avatarFallback)}</span><span class="sidebar-user-copy"><b>${escapeHTML(userName)}</b><small>${escapeHTML(roleName)}</small></span></div><button class="sidebar-signout" type="button" data-sidebar-signout><span class="sidebar-icon" aria-hidden="true">🚪</span><span>Sair</span></button></div>`;
  const overlay = document.createElement('button');
  overlay.className = 'sidebar-overlay';
  overlay.type = 'button';
  overlay.setAttribute('aria-label', 'Fechar menu');
  overlay.tabIndex = -1;
  body.prepend(overlay, aside);
  body.classList.add('has-app-sidebar');

  const toggle = document.createElement('button');
  toggle.className = 'mobile-menu-button';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Abrir menu');
  toggle.setAttribute('aria-controls', 'app-sidebar');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = '<span aria-hidden="true">☰</span>';
  const toggleIcon = toggle.querySelector('span');
  const nav = header.querySelector('.dashboard-nav');
  header.insertBefore(toggle, nav || null);
  const headerUser = document.createElement('span');
  headerUser.className = 'header-user-chip';
  headerUser.innerHTML = `<span class="header-user-avatar">${photoURL ? `<img src="${escapeHTML(photoURL)}" alt="">` : escapeHTML(avatarFallback)}</span><span>${escapeHTML(userName)}</span>`;
  const signout = nav?.querySelector('[data-signout]');
  if (signout) nav.insertBefore(headerUser, signout);
  else nav?.append(headerUser);
  window.addEventListener('eduspace:profile-photo', (event) => {
    if (event.detail?.uid !== user.uid) return;
    for (const element of aside.querySelectorAll('.sidebar-avatar')) updateAvatarElement(element, event.detail.url, initial, event.detail.avatarId);
    for (const element of header.querySelectorAll('.header-user-avatar')) updateAvatarElement(element, event.detail.url, initial, event.detail.avatarId);
  });

  const closeMenu = () => {
    body.classList.remove('sidebar-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menu');
    toggleIcon.textContent = '☰';
  };
  toggle.addEventListener('click', () => {
    const open = body.classList.toggle('sidebar-open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    toggleIcon.textContent = open ? '×' : '☰';
  });
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  aside.querySelectorAll('.sidebar-item[href^="#"]').forEach((link) => link.addEventListener('click', (event) => {
    const filter = link.dataset.sidebarFilter;
    if (filter) document.querySelector(`[data-filter="${filter}"]`)?.click();
    const target = document.getElementById(link.hash.slice(1));
    if (target) { event.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); history.replaceState(null, '', link.hash); }
    aside.querySelectorAll('.sidebar-item').forEach((item) => item.classList.toggle('active', item === link));
    closeMenu();
  }));
  aside.querySelectorAll('.sidebar-item[href="forum.html"]').forEach((link) => {
    if (location.pathname.endsWith('/forum.html') || location.pathname === 'forum.html') link.classList.add('active');
    link.addEventListener('click', closeMenu);
  });
  aside.querySelector('[data-sidebar-signout]').addEventListener('click', async (event) => {
    event.preventDefault();
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const label = button.querySelector('span:last-child');
    if (label) label.textContent = 'Saindo...';
    try {
      await signOut(auth);
      location.replace('login.html');
    } catch (error) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (label) label.textContent = 'Sair';
      const notice = document.querySelector('#form-message, #admin-message, #forum-message');
      if (notice) { notice.textContent = error.message || 'Não foi possível encerrar a sessão. Tente novamente.'; notice.hidden = false; }
    }
  });
  const initialTarget = location.hash && document.querySelector(`.sidebar-item[href="${CSS.escape(location.hash)}"]`);
  if (initialTarget) initialTarget.classList.add('active');
}

function updateAvatarElement(element, url, initial, avatarId = "") {
  element.replaceChildren();
  if (!url) { element.textContent = ({ rapaz1: '👨🏻‍🎓', rapaz2: '👨🏽‍💻', rapaz3: '👨🏾‍🔬', moca1: '👩🏻‍🎓', moca2: '👩🏽‍💻', moca3: '👩🏾‍🔬' })[avatarId] || initial; return; }
  const image = document.createElement('img');
  image.src = url;
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => { element.replaceChildren(); element.textContent = initial; });
  element.append(image);
}
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  try {
    let role;
    let profile;
    if ((user.email || '').toLowerCase() === 'teste01@gmail.com') {
      role = 'admin';
      profile = { nome: user.displayName || 'Administrador' };
    } else {
      const snapshot = await getDoc(doc(db, 'users', user.uid));
      if (!snapshot.exists()) return;
      profile = snapshot.data();
      role = profile.tipo;
    }
    if (role === 'aluno' || role === 'professor' || role === 'admin') renderSidebar(role, profile, user);
  } catch (error) { console.error('Não foi possível montar o menu X-EDU+:', error); }
});














