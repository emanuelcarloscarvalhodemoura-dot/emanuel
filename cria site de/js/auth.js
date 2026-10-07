import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const messageBox = document.querySelector('#form-message');
const showMessage = (message, kind = 'error') => {
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `form-message is-${kind}`;
  messageBox.hidden = false;
};
const friendlyError = (error) => {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já tem uma conta. Tente entrar.',
    'auth/invalid-email': 'Confira o formato do e-mail e tente novamente.',
    'auth/weak-password': 'Sua senha precisa ter pelo menos 6 caracteres.',
    'auth/invalid-credential': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
    'auth/wrong-password': 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Sem conexão com o serviço. Verifique sua internet e tente novamente.',
    'permission-denied': 'O Firestore recusou o acesso. Confira se as regras do banco foram publicadas.'
  };
  return messages[error.code] || `Não foi possível concluir. ${error.message || 'Tente novamente.'}`;
};
const setBusy = (form, busy, label) => {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  button.disabled = busy;
  button.querySelector('span').textContent = busy ? label : button.dataset.label;
};

document.querySelectorAll('button[data-password-toggle]').forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordToggle);
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.setAttribute('aria-label', reveal ? 'Ocultar senha' : 'Mostrar senha');
  });
});

document.querySelectorAll('#login-form button[type="submit"], #register-form button[type="submit"], #reset-form button[type="submit"]').forEach((button) => {
  button.dataset.label = button.querySelector('span').textContent;
});

const roleRadios = document.querySelectorAll('input[name="role"]');
const teacherNote = document.querySelector('#teacher-note');
roleRadios.forEach((radio) => radio.addEventListener('change', () => {
  if (teacherNote) teacherNote.hidden = document.querySelector('input[name="role"]:checked').value !== 'professor';
}));

const registerForm = document.querySelector('#register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageBox.hidden = true;
    const form = new FormData(registerForm);
    const name = String(form.get('name')).trim();
    const email = String(form.get('email')).trim().toLowerCase();
    const password = String(form.get('password'));
    const role = String(form.get('role'));
    if (name.length < 2) return showMessage('Digite seu nome completo para continuar.');
    if (password.length < 6) return showMessage('Sua senha precisa ter pelo menos 6 caracteres.');
    setBusy(registerForm, true, 'Criando conta...');
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });
      await setDoc(doc(db, 'users', credential.user.uid), {
        nome: name,
        email,
        tipo: role,
        status: role === 'aluno' ? 'active' : 'pending'
      });
      location.href = role === 'aluno' ? 'aluno.html' : 'aguardando-aprovacao.html';
    } catch (error) {
      console.error('Falha no cadastro:', error);
      showMessage(friendlyError(error));
      setBusy(registerForm, false);
    }
  });
}

const loginForm = document.querySelector('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageBox.hidden = true;
    const form = new FormData(loginForm);
    setBusy(loginForm, true, 'Entrando...');
    try {
      const credential = await signInWithEmailAndPassword(auth, String(form.get('email')).trim().toLowerCase(), String(form.get('password')));
      if ((credential.user.email || '').toLowerCase() === 'teste01@gmail.com') {
        location.href = 'admin.html';
        return;
      }
      const profile = await getDoc(doc(db, 'users', credential.user.uid));
      if (!profile.exists()) throw new Error('Esta conta ainda não tem um perfil do X-EDU+. Faça o cadastro novamente ou fale com o suporte.');
      const data = profile.data();
      if (data.status === 'pending') {
        location.href = 'aguardando-aprovacao.html';
      } else if (data.status === 'active' && data.tipo === 'aluno') {
        location.href = 'aluno.html';
      } else if (data.status === 'active' && data.tipo === 'professor') {
        location.href = 'professor.html';
      } else {
        await signOut(auth);
        throw new Error('Esta conta está inativa. Fale com um administrador do X-EDU+.');
      }
    } catch (error) {
      console.error('Falha no login:', error);
      showMessage(friendlyError(error));
      setBusy(loginForm, false);
    }
  });
}

const resetForm = document.querySelector('#reset-form');
if (resetForm) {
  resetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    messageBox.hidden = true;
    const email = String(new FormData(resetForm).get('email') || '').trim().toLowerCase();
    if (!email) return showMessage('Digite o e-mail da sua conta.');
    setBusy(resetForm, true, 'Enviando...');
    try {
      await sendPasswordResetEmail(auth, email);
      showMessage('Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'success');
      resetForm.reset();
    } catch (error) {
      console.error('Falha ao solicitar redefinição de senha:', error);
      if (error.code === 'auth/user-not-found') {
        showMessage('Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.', 'success');
        resetForm.reset();
      } else {
        showMessage(friendlyError(error));
      }
    } finally {
      setBusy(resetForm, false);
    }
  });
}

const page = document.body.dataset.protected;
if (page) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return location.replace('login.html');
    if ((user.email || '').toLowerCase() === 'teste01@gmail.com') {
      if (page !== 'forum') return location.replace('admin.html');
      document.body.dataset.userRole = 'admin';
      document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.displayName || 'Administrador'; });
      document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email || ''; });
      return;
    }
    try {
      const profile = await getDoc(doc(db, 'users', user.uid));
      if (!profile.exists()) {
        await signOut(auth);
        return location.replace('login.html');
      }
      const data = profile.data();
      if (data.status === 'inactive'
        || !['aluno', 'professor'].includes(data.tipo)
        || (data.status === 'pending' && data.tipo !== 'professor')) {
        await signOut(auth);
        return location.replace('login.html');
      }
      const correctRole = page === 'forum' ? ['aluno', 'professor'].includes(data.tipo) : page === data.tipo || (page === 'aguardando' && data.tipo === 'professor');
      const allowed = correctRole && (page === 'aguardando' ? data.status === 'pending' : data.status === 'active');
      if (!allowed) {
        location.replace(data.status === 'pending' ? 'aguardando-aprovacao.html' : data.tipo === 'professor' ? 'professor.html' : 'aluno.html');
        return;
      }
      document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = data.nome || user.displayName || 'Estudante'; });
      document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = data.email || user.email || ''; });
      document.querySelectorAll('[data-user-initial]').forEach((el) => { el.textContent = (data.nome || user.displayName || 'E').trim().charAt(0).toUpperCase(); });
    } catch (error) {
      console.error('Falha ao carregar perfil:', error);
      const notice = document.querySelector('#page-message');
      if (notice) { notice.textContent = friendlyError(error); notice.hidden = false; }
    }
  });
}

document.querySelectorAll('[data-signout]').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await signOut(auth); location.href = 'index.html'; }
    catch (error) { button.disabled = false; showMessage(friendlyError(error)); }
  });
});



