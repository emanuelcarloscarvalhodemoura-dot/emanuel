import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getDownloadURL, ref } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

let currentUser = null;
let profile = null;
let questions = [];
let activeQuestion = null;
let activeStatusFilter = 'all';
const list = document.querySelector('#forum-questions');
const message = document.querySelector('#forum-message');
const questionDialog = document.querySelector('#question-dialog');
const threadDialog = document.querySelector('#thread-dialog');
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const showMessage = (text, kind = 'error') => { message.textContent = text; message.className = `form-message is-${kind}`; message.hidden = false; };
const friendlyError = (error) => {
  console.error('Fórum de dúvidas:', error);
  if (error?.code === 'permission-denied') return 'O Firebase bloqueou esta ação. Confira se as regras atualizadas do fórum foram publicadas.';
  if (error?.code === 'unavailable') return 'Sem conexão com o Firebase. Verifique sua internet e tente novamente.';
  return 'Não foi possível concluir. Tente novamente.';
};
const dateLabel = (timestamp) => timestamp?.toDate ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp.toDate()) : 'Agora';
const roleLabel = (type) => type === 'professor' ? '<span class="forum-role teacher-role">✓ Professor</span>' : type === 'admin' ? '<span class="forum-role teacher-role">Administrador</span>' : '<span class="forum-role student-role">Aluno</span>';

const avatarPhotoCache = new Map();
function forumAvatarMarkup(name, uid) {
  const initial = (String(name || 'E').trim().charAt(0) || 'E').toLocaleUpperCase('pt-BR');
  return `<span class="forum-person-avatar" data-forum-avatar="${escapeHTML(uid || '')}" data-initial="${escapeHTML(initial)}">${escapeHTML(initial)}</span>`;
}
function photoFor(uid) {
  if (!uid) return Promise.resolve('');
  if (!avatarPhotoCache.has(uid)) avatarPhotoCache.set(uid, getDownloadURL(ref(storage, `profilePhotos/${uid}/profile.jpg`)).catch(() => ''));
  return avatarPhotoCache.get(uid);
}
async function hydrateForumAvatars(root) {
  const avatars = [...root.querySelectorAll('[data-forum-avatar]')].filter((item) => item.dataset.forumAvatar);
  await Promise.all(avatars.map(async (element) => {
    const url = await photoFor(element.dataset.forumAvatar);
    if (!url || !element.isConnected) return;
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { element.replaceChildren(); element.textContent = element.dataset.initial || 'E'; });
    element.replaceChildren(image);
  }));
}
window.addEventListener('eduspace:profile-photo', (event) => {
  const { uid, url } = event.detail || {};
  if (!uid) return;
  avatarPhotoCache.set(uid, Promise.resolve(url || ''));
  hydrateForumAvatars(document);
});

onAuthStateChanged(auth, async (user) => {
  if (!user) return;
  currentUser = user;
  try {
    const userSnapshot = await getDoc(doc(db, 'users', user.uid));
    if ((user.email || '').toLowerCase() === 'teste01@gmail.com') {
      profile = { nome: user.displayName || 'Administrador', tipo: 'admin', status: 'active' };
      document.querySelector('#new-question').hidden = true;
    } else {
      if (!userSnapshot.exists()) throw new Error('Perfil não encontrado.');
      profile = userSnapshot.data();
    }
    await Promise.all([loadCourses(), loadQuestions()]);
  } catch (error) { showMessage(friendlyError(error)); }
});

async function loadCourses() {
  if (profile.tipo === 'admin') return;
  const courseSelect = document.querySelector('#forum-course');
  const coursesQuery = profile.tipo === 'professor'
    ? query(collection(db, 'courses'), where('teacherId', '==', currentUser.uid))
    : query(collection(db, 'courses'), where('published', '==', true));
  const snapshot = await getDocs(coursesQuery);
  const courses = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'pt-BR'));
  courseSelect.insertAdjacentHTML('beforeend', courses.map((course) => `<option value="${escapeHTML(course.id)}">${escapeHTML(course.title || course.subject || 'Curso')}</option>`).join(''));
}

async function loadQuestions() {
  list.innerHTML = '<div class="learning-empty">Carregando dúvidas...</div>';
  try {
    const snapshot = await getDocs(query(collection(db, 'forumQuestions'), orderBy('createdAt', 'desc'), limit(60)));
    questions = await Promise.all(snapshot.docs.map(async (entry) => {
      const data = entry.data();
      const replies = await getDocs(collection(db, 'forumQuestions', entry.id, 'replies'));
      return { id: entry.id, ...data, replyCount: replies.size };
    }));
    renderQuestions();
  } catch (error) {
    list.innerHTML = '<div class="learning-empty">Não foi possível carregar as dúvidas.</div>';
    showMessage(friendlyError(error));
  }
}

function renderQuestions() {
  const term = document.querySelector('#forum-search').value.trim().toLocaleLowerCase('pt-BR');
  const filtered = questions.filter((question) => {
    const matchesTerm = `${question.title || ''} ${question.description || ''} ${question.courseName || ''} ${question.authorName || ''}`.toLocaleLowerCase('pt-BR').includes(term);
    const matchesStatus = activeStatusFilter === 'all' || (activeStatusFilter === 'answered' ? question.replyCount > 0 : question.replyCount === 0);
    return matchesTerm && matchesStatus;
  });
  document.querySelector('#forum-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'dúvida' : 'dúvidas'}`;
  if (!filtered.length) {
    list.innerHTML = `<div class="learning-empty"><strong>${term ? 'Nenhuma dúvida encontrada' : 'O fórum está começando'}</strong>${term ? 'Tente buscar por outro termo.' : 'Seja a primeira pessoa a compartilhar uma pergunta.'}</div>`;
    return;
  }
  list.innerHTML = filtered.map((question) => `<article class="forum-question-card"><button class="forum-question-open" type="button" data-open-question="${escapeHTML(question.id)}"><span class="forum-question-main"><span class="forum-question-title">${escapeHTML(question.title || 'Dúvida sem título')}</span><span class="forum-question-preview">${escapeHTML(question.description || '')}</span></span><span class="forum-question-meta"><span class="forum-person">${forumAvatarMarkup(question.authorName || 'Usuário', question.authorId)}<span class="forum-author-copy"><b>${escapeHTML(question.authorName || 'Usuário')}</b>${roleLabel(question.authorType)}</span></span><span>${escapeHTML(question.courseName || 'Geral')}</span><span>${dateLabel(question.createdAt)}</span></span><span class="forum-reply-count">▤ ${question.replyCount} ${question.replyCount === 1 ? 'resposta' : 'respostas'} <b aria-hidden="true">→</b></span></button></article>`).join('');
  hydrateForumAvatars(list);
}

document.querySelector('#forum-search').addEventListener('input', renderQuestions);
document.querySelectorAll('[data-forum-filter]').forEach((button) => button.addEventListener('click', () => {
  activeStatusFilter = button.dataset.forumFilter;
  document.querySelectorAll('[data-forum-filter]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('is-selected', selected);
    item.setAttribute('aria-pressed', String(selected));
  });
  renderQuestions();
}));
document.querySelector('#new-question').addEventListener('click', () => { message.hidden = true; document.querySelector('#question-form').reset(); questionDialog.showModal(); });
document.querySelector('#question-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  const courseId = String(values.get('courseId') || '');
  const courseName = courseId ? document.querySelector('#forum-course').selectedOptions[0]?.textContent || '' : '';
  submit.disabled = true;
  try {
    await addDoc(collection(db, 'forumQuestions'), {
      title: String(values.get('title')).trim(),
      description: String(values.get('description')).trim(),
      authorId: currentUser.uid,
      authorName: profile.nome || currentUser.displayName || 'Usuário',
      authorType: profile.tipo,
      courseId,
      courseName,
      createdAt: serverTimestamp(),
      acceptedAnswerId: ''
    });
    questionDialog.close();
    showMessage('Sua dúvida foi publicada.', 'success');
    await loadQuestions();
  } catch (error) { showMessage(friendlyError(error)); }
  finally { submit.disabled = false; }
});

list.addEventListener('click', (event) => {
  const button = event.target.closest('[data-open-question]');
  if (button) openQuestion(button.dataset.openQuestion);
});

async function openQuestion(questionId) {
  try {
    const snapshot = await getDoc(doc(db, 'forumQuestions', questionId));
    if (!snapshot.exists()) throw new Error('Dúvida não encontrada.');
    activeQuestion = { id: snapshot.id, ...snapshot.data() };
    await renderThread();
    threadDialog.showModal();
  } catch (error) { showMessage(friendlyError(error)); }
}

async function renderThread() {
  const question = activeQuestion;
  document.querySelector('#thread-title').textContent = question.title || 'Dúvida';
  const content = document.querySelector('#thread-content');
  content.innerHTML = '<div class="learning-empty">Carregando respostas...</div>';
  const replySnapshot = await getDocs(query(collection(db, 'forumQuestions', question.id, 'replies'), orderBy('createdAt', 'asc')));
  const replies = replySnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const repliesHTML = replies.length ? replies.map((reply) => {
    const accepted = question.acceptedAnswerId === reply.id;
    const canAccept = question.authorId === currentUser.uid && question.authorId !== reply.authorId;
    return `<article class="forum-reply ${accepted ? 'accepted-reply' : ''}"><div class="forum-reply-top"><span class="forum-person">${forumAvatarMarkup(reply.authorName || 'Usuário', reply.authorId)}<span class="forum-author-copy"><b>${escapeHTML(reply.authorName || 'Usuário')}</b>${roleLabel(reply.authorType)}</span></span><time>${dateLabel(reply.createdAt)}</time></div><p>${escapeHTML(reply.text || '')}</p>${accepted ? '<span class="accepted-label">✓ Resposta aceita</span>' : canAccept ? `<button class="accept-answer" type="button" data-accept-answer="${escapeHTML(reply.id)}">Marcar como resposta aceita</button>` : ''}</article>`;
  }).join('') : '<div class="forum-no-replies">Ainda não há respostas. Se souber, ajude a comunidade!</div>';
  content.innerHTML = `<article class="forum-thread-question"><div class="forum-question-meta"><span class="forum-person">${forumAvatarMarkup(question.authorName || 'Usuário', question.authorId)}<span class="forum-author-copy"><b>${escapeHTML(question.authorName || 'Usuário')}</b>${roleLabel(question.authorType)}</span></span><span>${escapeHTML(question.courseName || 'Geral')}</span><time>${dateLabel(question.createdAt)}</time></div><p>${escapeHTML(question.description || '')}</p></article><section class="forum-replies"><div class="forum-replies-heading"><h3>Respostas</h3><span>${replies.length}</span></div>${repliesHTML}</section>${profile.tipo === 'admin' ? '' : `<form id="reply-form" class="forum-reply-form"><label for="reply-text">Sua resposta</label><textarea id="reply-text" name="text" rows="4" maxlength="2000" required placeholder="Escreva uma resposta clara e respeitosa..."></textarea><button class="button button-primary" type=submit><span>Enviar resposta</span><span aria-hidden="true">→</span></button></form>`};
  hydrateForumAvatars(content);
  content.querySelector('#reply-form')?.addEventListener('submit', submitReply);
  content.querySelectorAll('[data-accept-answer]').forEach((button) => button.addEventListener('click', acceptAnswer));
}

async function submitReply(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await addDoc(collection(db, 'forumQuestions', activeQuestion.id, 'replies'), {
      authorId: currentUser.uid,
      authorName: profile.nome || currentUser.displayName || 'Usuário',
      authorType: profile.tipo,
      text: String(new FormData(form).get('text') || '').trim(),
      createdAt: serverTimestamp()
    });
    await renderThread();
    await loadQuestions();
  } catch (error) { showMessage(friendlyError(error)); button.disabled = false; }
}

async function acceptAnswer(event) {
  const answerId = event.currentTarget.dataset.acceptAnswer;
  event.currentTarget.disabled = true;
  try {
    await updateDoc(doc(db, 'forumQuestions', activeQuestion.id), { acceptedAnswerId: answerId });
    activeQuestion.acceptedAnswerId = answerId;
    await renderThread();
  } catch (error) { showMessage(friendlyError(error)); event.currentTarget.disabled = false; }
}

document.querySelectorAll('[data-close-forum-dialog]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.closeForumDialog)?.close()));






