import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// This value must match the administrator check in firestore.rules.
const ADMIN_EMAIL = 'teste01@gmail.com';
const tableBody = document.querySelector('#users-table-body');
const messageBox = document.querySelector('#admin-message');
const searchInput = document.querySelector('#user-search');
const emptyState = document.querySelector('#empty-users');
const detailDialog = document.querySelector('#admin-detail-dialog');
let users = [];
let courses = [];
let enrollments = [];
let attempts = [];
let activities = [];
let questions = [];
let activeFilter = 'todos';
let busyUserId = null;

function showMessage(message, kind = 'error') {
  messageBox.textContent = message;
  messageBox.className = `form-message is-${kind}`;
  messageBox.hidden = false;
}
function safeText(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function dateLabel(timestamp) {
  if (!timestamp?.toDate) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp.toDate());
}
function roleLabel(role) {
  return ({ aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' })[role] || role || 'Não informado';
}
function statusLabel(status) {
  return ({ active: 'Ativo', pending: 'Pendente', inactive: 'Inativo' })[status] || status || 'Não informado';
}
function updateStats() {
  const pending = users.filter((user) => user.tipo === 'professor' && user.status === 'pending').length;
  document.querySelector('#total-users').textContent = users.length;
  document.querySelector('#metric-students').textContent = users.filter((user) => user.tipo === 'aluno').length;
  document.querySelector('#total-teachers').textContent = users.filter((user) => user.tipo === 'professor').length;
  document.querySelector('#pending-teachers').textContent = pending;
  document.querySelector('#pending-tab-count').textContent = pending;
  document.querySelector('#total-students').textContent = users.filter((user) => user.tipo === 'aluno').length;
  document.querySelector('#active-users').textContent = users.filter((user) => user.status === 'active').length;
  document.querySelector('#total-courses').textContent = courses.length;
  document.querySelector('#metric-courses').textContent = courses.length;
  document.querySelector('#total-activities').textContent = activities.length;
  document.querySelector('#metric-activities').textContent = activities.length;
  document.querySelector('#total-attempts').textContent = attempts.length;
  const average = attempts.length ? Math.round(attempts.reduce((sum, attempt) => sum + (Number(attempt.total) ? Number(attempt.score) / Number(attempt.total) * 100 : 0), 0) / attempts.length) : null;
  document.querySelector('#average-score').textContent = average === null ? 'Sem dados' : `${average}%`;
  document.querySelector('#course-count-label').textContent = `${courses.length} ${courses.length === 1 ? 'curso' : 'cursos'}`;
  document.querySelector('#forum-total').textContent = questions.length;
  document.querySelector('#metric-forum').textContent = questions.length;
  document.querySelector('#forum-answered').textContent = questions.filter((question) => question.replyCount > 0).length;
  document.querySelector('#forum-unanswered').textContent = questions.filter((question) => question.replyCount === 0).length;
}
function filteredUsers() {
  const search = searchInput.value.trim().toLocaleLowerCase('pt-BR');
  return users.filter((user) => {
    const matchesFilter = activeFilter === 'todos'
      || (activeFilter === 'pendentes' && user.tipo === 'professor' && user.status === 'pending')
      || (activeFilter === 'professores' && user.tipo === 'professor')
      || (activeFilter === 'alunos' && user.tipo === 'aluno')
      || (activeFilter === 'administradores' && user.tipo === 'admin');
    const matchesSearch = !search || `${user.nome || ''} ${user.email || ''}`.toLocaleLowerCase('pt-BR').includes(search);
    return matchesFilter && matchesSearch;
  }).sort((a, b) => Number(b.tipo === 'professor' && b.status === 'pending') - Number(a.tipo === 'professor' && a.status === 'pending') || String(a.nome || a.email).localeCompare(String(b.nome || b.email), 'pt-BR'));
}
function statusAction(user) {
  if (user.tipo === 'admin') return '<span class="no-action">—</span>';
  if (user.tipo === 'professor' && user.status === 'pending') return `<button class="table-action approve-action" data-action="approve" data-id="${safeText(user.id)}" ${busyUserId === user.id ? 'disabled' : ''}>${busyUserId === user.id ? 'Salvando…' : 'Aprovar'}</button><button class="table-action deactivate-action" data-action="reject" data-id="${safeText(user.id)}">Recusar</button>`;
  if (user.status === 'active') return `<button class="table-action deactivate-action" data-action="deactivate" data-id="${safeText(user.id)}" ${busyUserId === user.id ? 'disabled' : ''}>${busyUserId === user.id ? 'Salvando…' : 'Desativar'}</button>`;
  if (user.status === 'inactive') return `<button class="table-action activate-action" data-action="activate" data-id="${safeText(user.id)}" ${busyUserId === user.id ? 'disabled' : ''}>${busyUserId === user.id ? 'Salvando…' : 'Reativar'}</button>`;
  return '<span class="no-action">—</span>';
}
function renderUsers() {
  const visibleUsers = filteredUsers();
  emptyState.hidden = visibleUsers.length > 0;
  tableBody.innerHTML = visibleUsers.map((user) => {
    const initials = safeText(({ rapaz1: '👨🏻‍🎓', rapaz2: '👨🏽‍💻', rapaz3: '👨🏾‍🔬', moca1: '👩🏻‍🎓', moca2: '👩🏽‍💻', moca3: '👩🏾‍🔬' })[user.profileAvatar] || (user.nome || user.email || '?').trim().charAt(0).toUpperCase());
    const statusClass = user.status === 'active' ? 'active' : user.status === 'pending' ? 'pending' : 'inactive';
    const typeClass = user.tipo === 'professor' ? 'teacher' : user.tipo === 'admin' ? 'admin' : 'student';
    return `<tr><td><div class="user-cell"><span class="table-avatar" data-admin-avatar-uid="${safeText(user.id)}">${user.profilePhoto ? `<img src="${safeText(user.profilePhoto)}" alt="">` : initials}</span><span><b>${safeText(user.nome || 'Sem nome')}</b><small>${safeText(user.email || '')}</small></span></div></td><td><span class="type-pill ${typeClass}">${safeText(roleLabel(user.tipo))}</span></td><td><span class="status-pill ${statusClass}"><i></i>${safeText(statusLabel(user.status))}</span></td><td>${dateLabel(user.createdAt)}</td><td class="action-cell"><button class="table-action" data-details="user" data-id="${safeText(user.id)}">Ver detalhes</button>${statusAction(user)}</td></tr>`;
  }).join('');
  if (!visibleUsers.length) tableBody.innerHTML = '';
}
function renderPending() {
  const pending = users.filter((user) => user.tipo === 'professor' && user.status === 'pending');
  const container = document.querySelector('#pending-teacher-list');
  container.innerHTML = pending.length ? pending.map((user) => `<article class="admin-data-row"><div><b>${safeText(user.nome || 'Sem nome')}</b><small>${safeText(user.email || '')} · Solicitação: ${dateLabel(user.createdAt)}</small></div><div class="admin-row-actions"><button class="table-action" data-details="user" data-id="${safeText(user.id)}">Ver detalhes</button><button class="table-action approve-action" data-action="approve" data-id="${safeText(user.id)}">Aprovar</button><button class="table-action deactivate-action" data-action="reject" data-id="${safeText(user.id)}">Recusar</button></div></article>`).join('') : '<p class="admin-muted">Não há professores aguardando aprovação.</p>';
}
function renderCourses() {
  const container = document.querySelector('#admin-course-list');
  container.innerHTML = courses.length ? courses.map((course) => {
    const students = enrollments.filter((entry) => entry.courseId === course.id).length;
    const quizCount = course.quizzes?.length || 0;
    return `<article class="admin-data-row"><div><b>${safeText(course.title || 'Curso sem título')}</b><small>${safeText(course.subject || 'Área não informada')} · Professor: ${safeText(course.teacherName || 'Não informado')} · ${students} alunos · ${quizCount} atividades · ${course.published ? 'Publicado' : 'Rascunho'}</small></div><button class="table-action" data-details="course" data-id="${safeText(course.id)}">Ver detalhes</button></article>`;
  }).join('') : '<p class="admin-muted">Nenhum curso encontrado.</p>';
}
function renderActivities() {
  const container = document.querySelector('#admin-activity-list');
  container.innerHTML = activities.length ? activities.map((activity) => `<article class="admin-data-row"><div><b>${safeText(activity.title || 'Atividade sem título')}</b><small>${safeText(activity.courseTitle || 'Curso')} · Professor: ${safeText(activity.teacherName || 'Não informado')} · Quiz · ${dateLabel(activity.createdAt)}</small></div><button class="table-action" data-details="activity" data-id="${safeText(activity.id)}">Ver detalhes</button></article>`).join('') : '<p class="admin-muted">Nenhuma atividade encontrada.</p>';
}
function renderForum() {
  const container = document.querySelector('#admin-forum-list');
  const recent = [...questions].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 30);
  container.innerHTML = recent.length ? recent.map((question) => `<article class="admin-data-row"><div><b>${safeText(question.title || 'Dúvida')}</b><small>${safeText(question.authorName || 'Usuário')} · ${safeText(question.courseName || 'Geral')} · ${dateLabel(question.createdAt)} · ${question.replyCount} respostas</small></div><div class="admin-row-actions"><button class="table-action" data-details="question" data-id="${safeText(question.id)}">Ver conversa</button><button class="table-action deactivate-action" data-moderate-question="${safeText(question.id)}">Remover</button></div></article>`).join('') : '<p class="admin-muted">Nenhuma pergunta no fórum.</p>';
}
function renderRecent() {
  const events = [
    ...courses.filter((item) => item.createdAt?.toDate).map((item) => ({ title: `Curso criado: ${item.title || 'Sem título'}`, createdAt: item.createdAt })),
    ...activities.filter((item) => item.createdAt?.toDate).map((item) => ({ title: `Atividade criada: ${item.title || 'Sem título'}`, createdAt: item.createdAt })),
    ...questions.filter((item) => item.createdAt?.toDate).map((item) => ({ title: `Pergunta publicada: ${item.title || 'Sem título'}`, createdAt: item.createdAt }))
  ].sort((a, b) => b.createdAt.seconds - a.createdAt.seconds).slice(0, 12);
  document.querySelector('#admin-recent-list').innerHTML = events.length ? events.map((event) => `<article class="admin-data-row"><div><b>${safeText(event.title)}</b><small>${dateLabel(event.createdAt)}</small></div></article>`).join('') : '<p class="admin-muted">Não há datas disponíveis para montar um histórico recente.</p>';
}
function renderOverview() {
  updateStats(); renderUsers(); renderPending(); renderCourses(); renderActivities(); renderForum(); renderRecent();
}
async function loadAdminRanking() {
  const container = document.querySelector('#admin-ranking-list');
  container.innerHTML = '<p class="admin-muted">Carregando ranking...</p>';
  try {
    const snapshot = await getDocs(query(collection(db, 'rankings'), where('points', '>', 0), orderBy('points', 'desc'), limit(10)));
    const entries = snapshot.docs.map((entry) => entry.data());
    let place = 0;
    container.innerHTML = entries.length ? entries.map((entry, index) => {
      if (index === 0 || Number(entries[index - 1].points) !== Number(entry.points)) place = index + 1;
      const points = Number(entry.points) || 0;
      return `<article class="admin-data-row"><div><b>${safeText(entry.studentName || 'Aluno')}</b><small>${points} ${points === 1 ? 'ponto' : 'pontos'} · ${place}º lugar</small></div></article>`;
    }).join('') : '<p class="admin-muted">Os alunos ainda não conquistaram pontos em testes.</p>';
  } catch (error) {
    console.error('[EduSpace] falha ao carregar ranking administrativo', { code: error?.code || 'unknown' });
    container.innerHTML = '<p class="admin-muted">Não foi possível carregar o ranking.</p>';
  }
}
async function loadUsers() {
  const refresh = document.querySelector('#refresh-users');
  refresh.disabled = true;
  refresh.classList.add('is-loading');
  document.querySelector('#admin-connection').textContent = 'Carregando dados...';
  try {
    const [userSnap, courseSnap, enrollmentSnap, attemptSnap, questionSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'courses')),
      getDocs(collection(db, 'enrollments')),
      getDocs(collection(db, 'attempts')),
      getDocs(collection(db, 'forumQuestions'))
    ]);
    users = userSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    courses = courseSnap.docs.map((entry) => ({ id: entry.id, ...entry.data(), quizzes: [] }));
    enrollments = enrollmentSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    attempts = attemptSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    questions = await Promise.all(questionSnap.docs.map(async (entry) => {
      const replies = await getDocs(collection(db, 'forumQuestions', entry.id, 'replies'));
      return { id: entry.id, ...entry.data(), replyCount: replies.size };
    }));
    activities = (await Promise.all(courses.map(async (course) => {
      const snapshot = await getDocs(collection(db, 'courses', course.id, 'quizzes'));
      course.quizzes = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      return course.quizzes.map((quiz) => ({ ...quiz, id: course.id + '_' + quiz.id, courseId: course.id, courseTitle: course.title, teacherName: course.teacherName }));
    }))).flat();
    document.querySelector('#admin-connection').textContent = 'Firebase conectado';
    document.querySelector('#settings-connection').textContent = 'Conectado';
    document.querySelector('#settings-connection').className = 'is-connected';
    renderOverview();
    await loadAdminRanking();
    messageBox.hidden = true;
  } catch (error) {
    console.error('Falha ao carregar dados administrativos:', error);
    document.querySelector('#admin-connection').textContent = 'Falha ao carregar';
    document.querySelector('#settings-connection').textContent = 'Não foi possível verificar';
    showMessage(error.code === 'permission-denied' ? 'Acesso negado ao carregar dados administrativos. Confira as regras do Firestore.' : 'Não foi possível carregar os dados do painel. Verifique a conexão e tente novamente.');
  } finally {
    refresh.disabled = false;
    refresh.classList.remove('is-loading');
  }
}
async function changeStatus(userId, status) {
  const user = users.find((item) => item.id === userId);
  if (!user) return;
  const isRejection = user.status === 'pending' && status === 'inactive';
  if (status === 'inactive' && !window.confirm(isRejection ? `Recusar a solicitação de ${user.nome || user.email}? O acesso ficará inativo.` : `Desativar o acesso de ${user.nome || user.email}?`)) return;
  if (status === 'active' && user.tipo === 'professor' && user.status === 'pending' && !window.confirm(`Aprovar o cadastro de ${user.nome || user.email}?`)) return;
  busyUserId = userId; renderUsers();
  try {
    const update = { status };
    if (status === 'active' && user.tipo === 'professor' && user.status === 'pending') update.approvedAt = serverTimestamp();
    await updateDoc(doc(db, 'users', userId), update);
    if (update.approvedAt) user.approvedAt = new Date();
    user.status = status;
    renderOverview();
    showMessage(isRejection ? 'Solicitação recusada. O acesso foi marcado como inativo.' : status === 'active' && user.tipo === 'professor' ? 'Professor aprovado. Já pode entrar na área de ensino.' : 'Status da conta atualizado.', 'success');
  } catch (error) {
    console.error('Falha ao atualizar usuário:', error);
    showMessage(error.code === 'permission-denied' ? 'A alteração foi bloqueada pelas regras do Firestore.' : 'Não foi possível alterar o status. Tente novamente.');
  } finally { busyUserId = null; renderOverview(); }
}
function detailsFor(type, id) {
  if (type === 'user') return users.find((item) => item.id === id);
  if (type === 'course') return courses.find((item) => item.id === id);
  if (type === 'activity') return activities.find((item) => item.id === id);
  if (type === 'question') return questions.find((item) => item.id === id);
  return null;
}
function showDetails(type, id) {
  const data = detailsFor(type, id);
  if (!data) return;
  const title = type === 'user' ? 'Detalhes do usuário' : type === 'course' ? 'Detalhes do curso' : type === 'activity' ? 'Detalhes da atividade' : 'Conversa do fórum';
  document.querySelector('#admin-detail-title').textContent = title;
  const content = document.querySelector('#admin-detail-content');
  if (type === 'question') {
    content.innerHTML = `<p><b>${safeText(data.title || 'Dúvida')}</b></p><p>${safeText(data.description || '')}</p><p>${safeText(data.authorName || 'Usuário')} · ${safeText(data.courseName || 'Geral')} · ${dateLabel(data.createdAt)}</p><div class="admin-detail-replies">Carregando respostas...</div>`;
    detailDialog.showModal();
    getDocs(collection(db, 'forumQuestions', id, 'replies')).then((snapshot) => {
      const replies = snapshot.docs.map((entry) => entry.data());
      content.querySelector('.admin-detail-replies').innerHTML = replies.length ? replies.map((reply) => `<article><b>${safeText(reply.authorName || 'Usuário')} ${reply.authorType === 'professor' ? '· Professor' : ''}</b><small>${dateLabel(reply.createdAt)}</small><p>${safeText(reply.text || '')}</p></article>`).join('') : '<p class="admin-muted">Sem respostas.</p>';
    }).catch(() => { content.querySelector('.admin-detail-replies').textContent = 'Não foi possível carregar respostas.'; });
    return;
  }
  const entries = type === 'user'
    ? [['Nome', data.nome], ['E-mail', data.email], ['Função', roleLabel(data.tipo)], ['Status', statusLabel(data.status)], ['Data de cadastro', dateLabel(data.createdAt)]]
    : type === 'course'
      ? [['Curso', data.title], ['Área', data.subject], ['Professor', data.teacherName], ['Alunos', enrollments.filter((entry) => entry.courseId === id).length], ['Atividades', data.quizzes?.length || 0], ['Status', data.published ? 'Publicado' : 'Rascunho'], ['Criado em', dateLabel(data.createdAt)], ['Descrição', data.description], ['Conteúdo', data.content]]
      : [['Atividade', data.title], ['Curso', data.courseTitle], ['Professor', data.teacherName], ['Tipo', 'Quiz'], ['Perguntas', (data.questions || []).map((item, index) => (index + 1) + '. ' + (item.prompt || 'Questão')).join('\n')], ['Criado em', dateLabel(data.createdAt)], ['Publicado', data.published ? 'Sim' : 'Não']];
  const visibleEntries = entries.filter(([, value]) => value !== undefined && value !== null && value !== '');
  const allowedExtra = type === 'user' ? Object.entries(data).filter(([key, value]) => !['id', 'nome', 'email', 'tipo', 'status', 'createdAt'].includes(key) && !/password|senha|token|secret|credential/i.test(key) && ['string', 'number', 'boolean'].includes(typeof value)) : [];
  content.innerHTML = `<dl class="admin-detail-grid">${[...visibleEntries, ...allowedExtra.map(([key, value]) => [key, value])].map(([key, value]) => `<div><dt>${safeText(key)}</dt><dd>${safeText(String(value))}</dd></div>`).join('')}</dl>`;
  detailDialog.showModal();
}
async function moderateQuestion(questionId) {
  const question = questions.find((item) => item.id === questionId);
  if (!question || !window.confirm(`Remover a pergunta “${question.title || 'Dúvida'}” e suas respostas? Essa ação é permanente.`)) return;
  try {
    const replies = await getDocs(collection(db, 'forumQuestions', questionId, 'replies'));
    await Promise.all(replies.docs.map((entry) => deleteDoc(doc(db, 'forumQuestions', questionId, 'replies', entry.id))));
    await deleteDoc(doc(db, 'forumQuestions', questionId));
    questions = questions.filter((item) => item.id !== questionId);
    renderOverview(); showMessage('Pergunta e respostas removidas do fórum.', 'success');
  } catch (error) {
    console.error('Falha ao moderar fórum:', error);
    showMessage(error.code === 'permission-denied' ? 'As regras do Firestore não permitiram remover esse conteúdo.' : 'Não foi possível concluir a moderação. Verifique se a pergunta ainda existe.');
  }
}
function globalSearch() {
  const input = document.querySelector('#admin-global-search');
  const output = document.querySelector('#admin-global-results');
  const term = input.value.trim().toLocaleLowerCase('pt-BR');
  if (!term) { output.hidden = true; output.innerHTML = ''; return; }
  const matches = [
    ...users.filter((item) => `${item.nome || ''} ${item.email || ''}`.toLocaleLowerCase('pt-BR').includes(term)).map((item) => ({ type: 'user', id: item.id, title: item.nome || item.email, meta: `Usuário · ${roleLabel(item.tipo)}` })),
    ...courses.filter((item) => `${item.title || ''} ${item.subject || ''} ${item.teacherName || ''}`.toLocaleLowerCase('pt-BR').includes(term)).map((item) => ({ type: 'course', id: item.id, title: item.title || 'Curso', meta: `Curso · ${item.teacherName || 'Professor não informado'}` })),
    ...activities.filter((item) => `${item.title || ''} ${item.courseTitle || ''} ${item.teacherName || ''}`.toLocaleLowerCase('pt-BR').includes(term)).map((item) => ({ type: 'activity', id: item.id, title: item.title || 'Atividade', meta: `Atividade · ${item.courseTitle || 'Curso'}` }))
  ].slice(0, 12);
  output.innerHTML = matches.length ? matches.map((item) => `<button type="button" data-details="${item.type}" data-id="${safeText(item.id)}"><b>${safeText(item.title)}</b><small>${safeText(item.meta)}</small></button>`).join('') : '<p class="admin-muted">Nenhum resultado encontrado.</p>';
  output.hidden = false;
}

document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('is-selected', item === button));
  activeFilter = button.dataset.filter;
  renderUsers();
}));
searchInput.addEventListener('input', renderUsers);
document.querySelector('#refresh-users').addEventListener('click', loadUsers);
tableBody.addEventListener('click', (event) => {
  const details = event.target.closest('[data-details]');
  if (details) { showDetails(details.dataset.details, details.dataset.id); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const status = { approve: 'active', activate: 'active', deactivate: 'inactive', reject: 'inactive' }[button.dataset.action];
  if (status) changeStatus(button.dataset.id, status);
});
document.querySelector('#pending-teacher-list').addEventListener('click', (event) => {
  const details = event.target.closest('[data-details]');
  if (details) { showDetails(details.dataset.details, details.dataset.id); return; }
  const button = event.target.closest('[data-action]');
  if (button) changeStatus(button.dataset.id, button.dataset.action === 'approve' ? 'active' : 'inactive');
});
for (const selector of ['#admin-course-list', '#admin-activity-list', '#admin-forum-list']) {
  document.querySelector(selector).addEventListener('click', (event) => {
    const details = event.target.closest('[data-details]');
    if (details) showDetails(details.dataset.details, details.dataset.id);
    const moderate = event.target.closest('[data-moderate-question]');
    if (moderate) moderateQuestion(moderate.dataset.moderateQuestion);
  });
}
document.querySelector('#admin-global-search').addEventListener('input', globalSearch);
document.querySelector('#migrate-quiz-keys').addEventListener('click', async (event) => {
  if (!window.confirm('Esta ação protegerá os gabaritos das atividades antigas no Firestore e removerá as respostas corretas dos documentos visíveis aos alunos. Continuar?')) return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Preparando…';
  try {
    const courseSnapshots = await getDocs(collection(db, 'courses'));
    const migrations = [];
    let skipped = 0;
    for (const courseSnapshot of courseSnapshots.docs) {
      const quizSnapshots = await getDocs(collection(db, 'courses', courseSnapshot.id, 'quizzes'));
      for (const quizSnapshot of quizSnapshots.docs) {
        const quiz = quizSnapshot.data();
        const validQuestions = Array.isArray(quiz.questions) && quiz.questions.length > 0 && quiz.questions.length <= 10
          && quiz.questions.every((question) => typeof question.prompt === 'string' && question.prompt.trim()
            && Array.isArray(question.options) && question.options.length === 4 && question.options.every((option) => typeof option === 'string'));
        if (!validQuestions) { skipped++; continue; }
        const keyRef = doc(db, 'courses', courseSnapshot.id, 'quizzes', quizSnapshot.id, 'answerKeys', 'correct');
        const existingKey = await getDoc(keyRef);
        const indices = existingKey.exists() ? existingKey.data().indices : quiz.questions.map((question) => question.correctIndex);
        if (!Array.isArray(indices) || indices.length !== quiz.questions.length || indices.some((value) => !Number.isInteger(value) || value < 0 || value > 3)) { skipped++; continue; }
        const questions = quiz.questions.map((question) => ({ prompt: question.prompt, options: question.options }));
        migrations.push({ quizRef: quizSnapshot.ref, keyRef, indices, questions, hasKey: existingKey.exists() });
      }
    }
    let migrated = 0;
    for (let offset = 0; offset < migrations.length; offset += 200) {
      const batch = writeBatch(db);
      const chunk = migrations.slice(offset, offset + 200);
      for (const item of chunk) {
        if (!item.hasKey) batch.set(item.keyRef, { indices: item.indices });
        batch.update(item.quizRef, { questions: item.questions, answerKeyStored: true, answerKeyVersion: 2 });
      }
      await batch.commit();
      migrated += chunk.length;
    }
    showMessage(`Gabaritos protegidos: ${migrated}. Não preparados: ${skipped}.`, 'success');
  } catch (error) {
    console.error('[EduSpace] falha ao preparar gabaritos', { code: error?.code || 'unknown', message: error?.message || '' });
    showMessage('Não foi possível proteger os gabaritos. Publique as regras atualizadas do Firestore e tente novamente.');
  } finally { button.disabled = false; button.textContent = 'Proteger gabaritos existentes'; }
});
window.addEventListener('eduspace:profile-photo', (event) => {
  const uid = event.detail?.uid;
  if (!uid) return;
  const row = [...document.querySelectorAll('[data-admin-avatar-uid]')].find((element) => element.dataset.adminAvatarUid === uid);
  if (!row) return;
  row.replaceChildren();
  if (event.detail.url) {
    const image = document.createElement('img');
    image.src = event.detail.url;
    image.alt = '';
    row.append(image);
  } else { const profile = users.find((item) => item.id === uid); row.textContent = ({ rapaz1: '👨🏻‍🎓', rapaz2: '👨🏽‍💻', rapaz3: '👨🏾‍🔬', moca1: '👩🏻‍🎓', moca2: '👩🏽‍💻', moca3: '👩🏾‍🔬' })[event.detail.avatarId || profile?.profileAvatar] || (profile?.nome || 'E').trim().charAt(0).toUpperCase(); }
});
document.querySelector('#admin-global-results').addEventListener('click', (event) => {
  const result = event.target.closest('[data-details]');
  if (result) showDetails(result.dataset.details, result.dataset.id);
});
document.querySelectorAll('[data-close-admin-dialog]').forEach((button) => button.addEventListener('click', () => detailDialog.close()));
detailDialog.addEventListener('click', (event) => { if (event.target === detailDialog) detailDialog.close(); });
document.querySelector('[data-signout]').addEventListener('click', async (event) => {
  event.currentTarget.disabled = true;
  try { await signOut(auth); location.replace('login.html'); }
  catch { event.currentTarget.disabled = false; showMessage('Não foi possível encerrar a sessão.'); }
});
onAuthStateChanged(auth, async (user) => {
  if (!user) return location.replace('login.html');
  if ((user.email || '').toLowerCase() !== ADMIN_EMAIL.toLowerCase()) return location.replace('index.html');
  document.querySelector('[data-admin-email]').textContent = user.email;
  await loadUsers();
});









