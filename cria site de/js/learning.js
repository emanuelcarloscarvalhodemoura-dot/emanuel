import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit,
  orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const role = document.body.dataset.protected;
if (!['aluno', 'professor'].includes(role)) throw new Error('Perfil de aprendizagem inválido.');

let currentUser = null;
let profile = null;
let teacherCourses = [];
let activeQuizCourse = null;
let activeQuizId = null;
let activeQuizPublished = true;
let activeQuizHasAttempts = false;
let studentCourses = [];
let enrolledCourseIds = new Set();
let studentQuizzesByCourse = new Map();
let studentAttempts = [];
let studentPendingActivities = [];
let studentRanking = null;

const messageBox = document.querySelector('#form-message');

const displayMessage = (message, kind = 'error') => {
  if (!messageBox) return;

  messageBox.textContent = message;
  messageBox.className = `form-message is-${kind}`;
  messageBox.hidden = false;
};

const clearMessage = () => {
  if (messageBox) messageBox.hidden = true;
};

const escapeHTML = (value = '') =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]
  );

const dateLabel = (timestamp) => {
  if (!timestamp?.toDate) return 'Agora';

  return new Intl.DateTimeFormat(
    'pt-BR',
    { dateStyle: 'medium' }
  ).format(timestamp.toDate());
};

function studentTimestampMillis(value) {
  try {
    if (value?.toMillis) return value.toMillis();

    if (Number.isFinite(value?.seconds)) {
      return value.seconds * 1000;
    }

    if (value instanceof Date) {
      return value.getTime();
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number'
    ) {
      const millis = new Date(value).getTime();

      return Number.isFinite(millis)
        ? millis
        : 0;
    }

  } catch {
    // aceita documentos antigos sem data válida
  }

  return 0;
}

function studentDateLabel(value) {
  const millis = studentTimestampMillis(value);

  return millis
    ? new Intl.DateTimeFormat(
        'pt-BR',
        {
          dateStyle: 'medium',
          timeStyle: 'short'
        }
      ).format(new Date(millis))
    : 'Data não registrada';
}

const setButtonBusy = (
  button,
  busy,
  busyText = 'Salvando…'
) => {
  if (!button) return;

  if (
    busy &&
    !button.dataset.originalText
  ) {
    button.dataset.originalText =
      button.textContent;
  }

  button.disabled = busy;

  button.textContent = busy
    ? busyText
    : (
        button.dataset.originalText ||
        button.textContent
      );

  if (!busy) {
    delete button.dataset.originalText;
  }
};

const firestoreError = (
  error,
  action
) => {
  console.error(
    action,
    error
  );

  if (
    error?.code === 'permission-denied'
  ) {
    return 'O Firebase bloqueou esta ação. Confira se as regras atualizadas foram publicadas e se a conta está ativa.';
  }

  if (
    error?.code === 'unavailable' ||
    error?.code === 'auth/network-request-failed'
  ) {
    return 'Sem conexão com o Firebase. Verifique sua internet e tente novamente.';
  }

  return `${action} Tente novamente.`;
};

async function migrateLegacyQuizzes() {
  if (
    !currentUser ||
    role !== 'professor'
  ) {
    return;
  }

  console.log(
    '[EduSpace] Procurando atividades antigas...'
  );

  try {
    const coursesSnapshot =
      await getDocs(
        query(
          collection(
            db,
            'courses'
          ),
          where(
            'teacherId',
            '==',
            currentUser.uid
          )
        )
      );

    let migrated = 0;
    let skipped = 0;

    for (
      const courseDoc
      of coursesSnapshot.docs
    ) {
      const courseId =
        courseDoc.id;

      const quizzesSnapshot =
        await getDocs(
          collection(
            db,
            'courses',
            courseId,
            'quizzes'
          )
        );

      for (
        const quizDoc
        of quizzesSnapshot.docs
      ) {
        const quiz =
          quizDoc.data();

        if (
          quiz.answerKeyVersion === 2 &&
          quiz.answerKeyStored === true
        ) {
          skipped++;
          continue;
        }

        const questions =
          Array.isArray(
            quiz.questions
          )
            ? quiz.questions
            : [];

        if (!questions.length) {
          console.warn(
            '[EduSpace] Quiz sem perguntas:',
            quizDoc.id
          );

          continue;
        }

        const correctIndices =
          questions.map(
            (question) =>
              Number(
                question.correctIndex
              )
          );

        const validKey =
          correctIndices.every(
            (index) =>
              Number.isInteger(index) &&
              index >= 0 &&
              index <= 3
          );

        if (!validKey) {
          console.warn(
            '[EduSpace] Quiz não pôde ser migrado:',
            quiz.title ||
            quizDoc.id
          );

          continue;
        }

        const safeQuestions =
          questions.map(
            (question) => ({
              prompt:
                question.prompt || '',

              options:
                Array.isArray(
                  question.options
                )
                  ? question.options
                  : []
            })
          );

        const quizRef =
          doc(
            db,
            'courses',
            courseId,
            'quizzes',
            quizDoc.id
          );

        const answerKeyRef =
          doc(
            db,
            'courses',
            courseId,
            'quizzes',
            quizDoc.id,
            'answerKeys',
            'correct'
          );

        const batch =
          writeBatch(db);

        batch.set(
          quizRef,
          {
            questions:
              safeQuestions,

            answerKeyStored:
              true,

            answerKeyVersion:
              2
          },
          {
            merge: true
          }
        );

        batch.set(
          answerKeyRef,
          {
            indices:
              correctIndices
          }
        );

        await batch.commit();

        migrated++;

        console.log(
          `[EduSpace] Migrada: ${
            quiz.title ||
            quizDoc.id
          }`
        );
      }
    }

    console.log(
      `[EduSpace] Migração concluída. ${migrated} atividade(s) migrada(s), ${skipped} já estavam atualizadas.`
    );

    if (migrated > 0) {
      displayMessage(
        `${migrated} atividade(s) antiga(s) recuperada(s) com sucesso.`,
        'success'
      );
    }

  } catch (error) {

    console.error(
      '[EduSpace] erro na migração das atividades antigas:',
      error
    );

    displayMessage(
      firestoreError(
        error,
        'Não foi possível recuperar as atividades antigas.'
      )
    );
  }
}

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) return;

    if (
      (user.email || '')
        .toLowerCase() ===
      'teste01@gmail.com'
    ) {
      return;
    }

    try {
      const snapshot =
        await getDoc(
          doc(
            db,
            'users',
            user.uid
          )
        );

      if (!snapshot.exists()) {
        return;
      }

      const data =
        snapshot.data();

      if (
        data.tipo !== role ||
        data.status !== 'active'
      ) {
        return;
      }

      currentUser = user;
      profile = data;

      if (
        role === 'professor'
      ) {
        await migrateLegacyQuizzes();

        await loadTeacherDashboard();

      } else {

        await loadStudentRanking();

        await loadStudentDashboard();
      }

    } catch (error) {

      displayMessage(
        firestoreError(
          error,
          'Não foi possível abrir seus dados.'
        )
      );
    }
  }
);


if (role === 'professor') {
  const courseForm = document.querySelector('#course-form');
  courseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser || !profile) return displayMessage('Aguarde a validação da sua conta e tente novamente.');
    clearMessage();
    const button = courseForm.querySelector('[type="submit"]');
    setButtonBusy(button, true, 'Criando…');
    const data = new FormData(courseForm);
    try {
      await addDoc(collection(db, 'courses'), {
        title: String(data.get('title')).trim(),
        subject: String(data.get('subject')).trim(),
        description: String(data.get('description')).trim(),
        content: String(data.get('content')).trim(),
        teacherId: currentUser.uid,
        teacherName: profile.nome || currentUser.displayName || 'Professor',
        published: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      courseForm.reset();
      displayMessage('Curso criado como rascunho. Publique quando estiver pronto para os alunos.', 'success');
      await loadTeacherDashboard();
    } catch (error) {
      displayMessage(firestoreError(error, 'Não foi possível criar o curso.'));
    } finally {
      setButtonBusy(button, false);
    }
  });

  document.querySelector('#refresh-teacher').addEventListener('click', loadTeacherDashboard);
  document.querySelector('#teacher-results').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-open-course-results]');
    const course = teacherCourses.find((item) => item.id === button?.dataset.openCourseResults);
    if (course) await showCourseResults(course);
  });
  document.querySelector('#teacher-courses').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-course-action]');
    if (!button || !currentUser) return;
    const course = teacherCourses.find((item) => item.id === button.dataset.courseId);
    if (!course) return;
    clearMessage();
    if (button.dataset.courseAction === 'manage') {
      await openTeacherCourse(course);
    } else if (button.dataset.courseAction === 'edit-content') {
      activeQuizCourse = course;
      document.querySelector('#edit-course-name').textContent = course.title;
      const editForm = document.querySelector('#content-edit-form');
      editForm.elements.title.value = course.title || '';
      editForm.elements.subject.value = course.subject || '';
      editForm.elements.description.value = course.description || '';
      editForm.elements.content.value = course.content || '';
      document.querySelector('#content-dialog').showModal();
    } else if (button.dataset.courseAction === 'publish') {
      setButtonBusy(button, true, 'Salvando…');
      try {
        await updateDoc(doc(db, 'courses', course.id), { published: !course.published, updatedAt: serverTimestamp() });
        course.published = !course.published;
        displayMessage(course.published ? 'Curso publicado e disponível para alunos.' : 'Curso retirado da lista pública.', 'success');
        await loadTeacherDashboard();
      } catch (error) { displayMessage(firestoreError(error, 'Não foi possível alterar a publicação.')); }
      finally { setButtonBusy(button, false); }
    } else if (button.dataset.courseAction === 'quiz') {
      activeQuizCourse = course;
      activeQuizId = null;
      activeQuizPublished = true;
      activeQuizHasAttempts = false;
      document.querySelector('#quiz-course-name').textContent = course.title;
      document.querySelector('#quiz-dialog-title').textContent = 'Criar atividade';
      document.querySelector('#quiz-form [type="submit"] span:first-child').textContent = 'Salvar atividade';
      document.querySelector('#quiz-form').reset();
      document.querySelector('#quiz-version-warning').hidden = true;
      document.querySelector('#question-list').innerHTML = questionEditor(0);
      renumberQuestions();
      document.querySelector('#quiz-dialog').showModal();
    } else if (button.dataset.courseAction === 'results') {
      await showCourseResults(course);
    }
  });

  document.querySelector('#content-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeQuizCourse) return;
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const values = {
      title: String(data.get('title')).trim(),
      subject: String(data.get('subject')).trim(),
      description: String(data.get('description')).trim(),
      content: String(data.get('content')).trim()
    };
    if (!values.content) return displayMessage('Escreva a explicação do conteúdo antes de salvar.');
    setButtonBusy(button, true, 'Salvando…');
    try {
      await updateDoc(doc(db, 'courses', activeQuizCourse.id), { ...values, updatedAt: serverTimestamp() });
      activeQuizCourse = { ...activeQuizCourse, ...values };
      document.querySelector('#content-dialog').close();
      displayMessage('Conteúdo do curso atualizado.', 'success');
      await loadTeacherDashboard();
      if (document.querySelector('#course-manager-dialog').open) {
        const refreshed = teacherCourses.find((course) => course.id === activeQuizCourse.id);
        if (refreshed) await openTeacherCourse(refreshed);
      }
    } catch (error) { displayMessage(firestoreError(error, 'Não foi possível atualizar o conteúdo.')); }
    finally { setButtonBusy(button, false); }
  });

  document.querySelector('#add-question').addEventListener('click', () => {
    const list = document.querySelector('#question-list');
    if (list.querySelectorAll('.question-item').length >= 10) {
      displayMessage('Cada teste pode ter até 10 perguntas.');
      return;
    }
    list.insertAdjacentHTML('beforeend', questionEditor(list.querySelectorAll('.question-item').length));
    renumberQuestions();
  });
  document.querySelector('#question-list').addEventListener('click', (event) => {
    const remove = event.target.closest('[data-remove-question]');
    if (remove && document.querySelectorAll('.question-item').length > 1) remove.closest('.question-item').remove();
    renumberQuestions();
  });
  document.querySelector('#quiz-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activeQuizCourse || !currentUser) return;
    const quizForm = event.currentTarget;
    const button = quizForm.querySelector('[type="submit"]');
    const title = String(new FormData(quizForm).get('title') || '').trim();
    const questions = [];
    for (const [index, item] of [...quizForm.querySelectorAll('.question-item')].entries()) {
      const prompt = item.querySelector('[data-question-prompt]').value.trim();
      const options = [...item.querySelectorAll('[data-question-option]')].map((input) => input.value.trim());
      const correctIndex = Number(item.querySelector('[data-correct-index]').value);
      if (!prompt || options.some((option) => !option)) return displayMessage(`Preencha a pergunta ${index + 1} e as quatro opções.`);
      questions.push({ prompt, options, correctIndex });
    }
    if (!title || questions.length === 0) return displayMessage('Informe o título e pelo menos uma pergunta.');
    if (activeQuizId && activeQuizHasAttempts && !window.confirm('Esta atividade já possui tentativas. Como o EduSpace não guarda versões antigas das perguntas, as correções históricas poderão refletir as alterações. Deseja continuar?')) return;
    clearMessage();
    setButtonBusy(button, true, 'Salvando…');
    try {
      const quizData = {
        title,
        questions: questions.map(({ prompt, options }) => ({ prompt, options })),
        published: activeQuizPublished,
        answerKeyStored: true,
        answerKeyVersion: 2,
        teacherId: currentUser.uid,
        createdAt: serverTimestamp()
      };
      const quizRef = activeQuizId ? doc(db, 'courses', activeQuizCourse.id, 'quizzes', activeQuizId) : doc(collection(db, 'courses', activeQuizCourse.id, 'quizzes'));
      if (activeQuizId) delete quizData.createdAt;
      const batch = writeBatch(db);
      if (activeQuizId) batch.set(quizRef, quizData, { merge: true });
      else batch.set(quizRef, quizData);
      batch.set(doc(quizRef, 'answerKeys', 'correct'), { indices: questions.map((question) => question.correctIndex) });
      await batch.commit();
      document.querySelector('#quiz-dialog').close();
      activeQuizId = null;
      displayMessage('Atividade salva. Ela aparece para alunos quando o curso está publicado.', 'success');
      const managerWasOpen = document.querySelector('#course-manager-dialog').open;
      await loadTeacherDashboard();
      if (managerWasOpen) {
        const refreshed = teacherCourses.find((course) => course.id === activeQuizCourse.id);
        if (refreshed) await openTeacherCourse(refreshed);
      }
    } catch (error) { displayMessage(firestoreError(error, 'Não foi possível salvar o quiz.')); }
    finally { setButtonBusy(button, false); }
  });

  document.querySelector('#course-manager-content').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-manager-action]');
    if (!button || !activeQuizCourse) return;
    const quizId = button.dataset.quizId;
    if (button.dataset.managerAction === 'edit-quiz') {
      try {
        const snapshot = await getDoc(doc(db, 'courses', activeQuizCourse.id, 'quizzes', quizId));
        if (!snapshot.exists()) throw new Error('Atividade não encontrada.');
        const quiz = snapshot.data();
        const keySnapshot = await getDoc(doc(db, 'courses', activeQuizCourse.id, 'quizzes', quizId, 'answerKeys', 'correct'));
        const correctIndices = keySnapshot.exists() ? keySnapshot.data().indices : (quiz.questions || []).map((question) => question.correctIndex);
        activeQuizId = quizId;
        activeQuizPublished = quiz.published !== false;
        const attemptsSnapshot = await getDocs(query(collection(db, 'attempts'), where('courseId', '==', activeQuizCourse.id)));
        const attemptsCount = attemptsSnapshot.docs.filter((attempt) => attempt.data().quizId === quizId).length;
        activeQuizHasAttempts = attemptsCount > 0;
        const warning = document.querySelector('#quiz-version-warning');
        warning.hidden = !activeQuizHasAttempts;
        warning.textContent = activeQuizHasAttempts ? `Esta atividade tem ${attemptsCount} tentativa(s). Editar as perguntas pode afetar a revisão dessas respostas, porque versões anteriores não são armazenadas.` : '';
        document.querySelector('#quiz-form').reset();
        document.querySelector('#quiz-form').elements.title.value = quiz.title || '';
        document.querySelector('#quiz-dialog-title').textContent = 'Editar atividade';
        document.querySelector('#quiz-form [type="submit"] span:first-child').textContent = 'Salvar alterações';
        document.querySelector('#quiz-course-name').textContent = activeQuizCourse.title;
        const list = document.querySelector('#question-list');
        list.innerHTML = (quiz.questions || []).map((question, index) => questionEditor(index)).join('');
        [...list.querySelectorAll('.question-item')].forEach((item, index) => {
          const question = quiz.questions[index];
          item.querySelector('[data-question-prompt]').value = question.prompt || '';
          item.querySelectorAll('[data-question-option]').forEach((input, optionIndex) => { input.value = question.options?.[optionIndex] || ''; });
          item.querySelector('[data-correct-index]').value = String(correctIndices[index] ?? 0);
        });
        renumberQuestions();
        document.querySelector('#quiz-dialog').showModal();
      } catch (error) { displayMessage(firestoreError(error, 'Não foi possível abrir a atividade.')); }
    } else if (button.dataset.managerAction === 'delete-quiz') {
      const quizTitle = button.dataset.quizTitle || 'esta atividade';
      if (!window.confirm(`Tem certeza que deseja excluir “${quizTitle}”? As tentativas existentes serão mantidas, mas não será mais possível abrir esta atividade.`)) return;
      setButtonBusy(button, true, 'Excluindo…');
      try {
        await deleteDoc(doc(db, 'courses', activeQuizCourse.id, 'quizzes', quizId));
        displayMessage('Atividade excluída. As tentativas anteriores foram preservadas.', 'success');
        await openTeacherCourse(activeQuizCourse);
        await loadTeacherDashboard();
      } catch (error) { displayMessage(firestoreError(error, 'Não foi possível excluir a atividade.')); }
      finally { setButtonBusy(button, false); }
    }
  });
  document.querySelector('#course-manager-content').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-course-action]');
    if (!button || !activeQuizCourse) return;
    const action = button.dataset.courseAction;
    if (action === 'edit-content') {
      document.querySelector('#edit-course-name').textContent = activeQuizCourse.title;
      const form = document.querySelector('#content-edit-form');
      form.elements.title.value = activeQuizCourse.title || '';
      form.elements.subject.value = activeQuizCourse.subject || '';
      form.elements.description.value = activeQuizCourse.description || '';
      form.elements.content.value = activeQuizCourse.content || '';
      document.querySelector('#content-dialog').showModal();
    } else if (action === 'quiz') {
      activeQuizId = null;
      activeQuizPublished = true;
      activeQuizHasAttempts = false;
      document.querySelector('#quiz-version-warning').hidden = true;
      document.querySelector('#quiz-course-name').textContent = activeQuizCourse.title;
      document.querySelector('#quiz-dialog-title').textContent = 'Criar atividade';
      document.querySelector('#quiz-form [type="submit"] span:first-child').textContent = 'Salvar atividade';
      document.querySelector('#quiz-form').reset();
      document.querySelector('#question-list').innerHTML = questionEditor(0);
      renumberQuestions();
      document.querySelector('#quiz-dialog').showModal();
    } else if (action === 'results') {
      await showCourseResults(activeQuizCourse);
    } else if (action === 'preview') {
      const preview = document.querySelector('#course-manager-content .course-manager-content-preview');
      preview?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      preview?.focus({ preventScroll: true });
    }
  });
}

function questionEditor(index) {
  return `<fieldset class="question-item"><div class="question-item-heading"><b>Pergunta</b><button class="remove-question" data-remove-question type="button">Remover</button></div><label>Enunciado<textarea data-question-prompt maxlength="350" required placeholder="Escreva a pergunta"></textarea></label><div class="question-options"><label>Opção A<input data-question-option maxlength="140" required placeholder="Resposta A"></label><label>Opção B<input data-question-option maxlength="140" required placeholder="Resposta B"></label><label>Opção C<input data-question-option maxlength="140" required placeholder="Resposta C"></label><label>Opção D<input data-question-option maxlength="140" required placeholder="Resposta D"></label></div><label>Resposta correta<select class="answer-select" data-correct-index><option value="0">Opção A</option><option value="1">Opção B</option><option value="2">Opção C</option><option value="3">Opção D</option></select></label></fieldset>`;
}

function renumberQuestions() {
  document.querySelectorAll('.question-item').forEach((item, index) => {
    item.querySelector('.question-item-heading b').textContent = `Pergunta ${index + 1}`;
    item.querySelector('[data-remove-question]').hidden = document.querySelectorAll('.question-item').length === 1;
  });
}

async function loadTeacherDashboard() {
  if (!currentUser) return;
  const courseGrid = document.querySelector('#teacher-courses');
  const studentsList = document.querySelector('#teacher-students');
  const resultsList = document.querySelector('#teacher-results');
  courseGrid.innerHTML = '<div class="learning-empty">Carregando cursos...</div>';
  studentsList.innerHTML = '<div class="learning-empty">Carregando alunos...</div>';
  resultsList.innerHTML = '<div class="learning-empty">Carregando resultados...</div>';
  try {
    const snapshot = await getDocs(query(collection(db, 'courses'), where('teacherId', '==', currentUser.uid)));
    teacherCourses = snapshot.docs.map((courseDoc) => ({ id: courseDoc.id, ...courseDoc.data() }));
    teacherCourses.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    const extra = await Promise.all(teacherCourses.map(async (course) => {
      const [quizzes, enrollments, attempts] = await Promise.all([
        getDocs(collection(db, 'courses', course.id, 'quizzes')),
        getDocs(query(collection(db, 'enrollments'), where('courseId', '==', course.id))),
        getDocs(query(collection(db, 'attempts'), where('courseId', '==', course.id)))
      ]);
      return {
        quizCount: quizzes.size,
        studentCount: enrollments.size,
        attemptCount: attempts.size,
        quizzes: quizzes.docs.map((item) => ({ id: item.id, ...item.data() })),
        enrollments: enrollments.docs.map((item) => ({ id: item.id, ...item.data() })),
        attempts: attempts.docs.map((item) => ({ id: item.id, ...item.data() }))
      };
    }));
    teacherCourses = teacherCourses.map((course, index) => ({ ...course, ...extra[index] }));
    document.querySelector('#teacher-course-count').textContent = teacherCourses.length;
    document.querySelector('#teacher-student-count').textContent = teacherCourses.reduce((sum, course) => sum + course.studentCount, 0);
    document.querySelector('#teacher-quiz-count').textContent = teacherCourses.reduce((sum, course) => sum + course.quizCount, 0);
    document.querySelector('#teacher-attempt-count').textContent = teacherCourses.reduce((sum, course) => sum + course.attemptCount, 0);
    courseGrid.innerHTML = teacherCourses.length ? teacherCourses.map(teacherCourseCard).join('') : '<div class="learning-empty"><strong>Seu primeiro curso começa aqui</strong>Use o formulário acima para criar um rascunho. Depois, adicione quizzes e publique.</div>';
    renderTeacherStudents(studentsList, teacherCourses);
    renderTeacherResults(resultsList, teacherCourses);
  } catch (error) {
    courseGrid.innerHTML = '<div class="learning-empty">Não foi possível carregar seus cursos.</div>';
    studentsList.innerHTML = '<div class="learning-empty">Não foi possível carregar os alunos. Atualize o painel para tentar novamente.</div>';
    resultsList.innerHTML = '<div class="learning-empty">Não foi possível carregar os resultados. Atualize o painel para tentar novamente.</div>';
    displayMessage(firestoreError(error, 'Falha ao carregar cursos.'));
  }
}

function shortStudentId(id) {
  const value = String(id || '');
  return value ? `${value.slice(0, 5)}…${value.slice(-3)}` : 'Identificação indisponível';
}

function renderTeacherStudents(container, courses) {
  const rows = courses.flatMap((course) => (course.enrollments || []).map((enrollment) => {
    const studentId = enrollment.studentId;
    const publishedQuizIds = new Set((course.quizzes || []).filter((quiz) => quiz.published !== false).map((quiz) => quiz.id));
    const completed = new Set((course.attempts || []).filter((attempt) => attempt.studentId === studentId && publishedQuizIds.has(attempt.quizId)).map((attempt) => attempt.quizId)).size;
    const total = publishedQuizIds.size;
    return { course, studentId, completed, total };
  })).filter((row) => row.studentId);
  container.innerHTML = rows.length ? rows.map(({ course, studentId, completed, total }) => `<article class="teacher-data-row"><div class="teacher-data-copy"><b>Aluno ${escapeHTML(shortStudentId(studentId))}</b><span>${escapeHTML(course.title || 'Curso sem título')}</span></div><div class="teacher-data-meta"><span>${completed} de ${total} atividades concluídas</span><small>${Math.max(0, total - completed)} pendentes</small></div></article>`).join('') : '<div class="learning-empty"><strong>Nenhum aluno inscrito</strong>As inscrições dos seus cursos aparecerão aqui.</div>';
}

function renderTeacherResults(container, courses) {
  const rows = courses.flatMap((course) => (course.attempts || []).map((attempt) => ({ course, attempt })))
    .sort((a, b) => studentTimestampMillis(b.attempt.submittedAt) - studentTimestampMillis(a.attempt.submittedAt));
  container.innerHTML = rows.length ? rows.map(({ course, attempt }) => {
    const score = Number(attempt.score || 0);
    const total = Number(attempt.total || 0);
    const percent = total > 0 ? Math.round(score / total * 100) : 0;
    const student = attempt.studentName || `Aluno ${shortStudentId(attempt.studentId)}`;
    return `<article class="teacher-data-row"><div class="teacher-data-copy"><b>${escapeHTML(student)}</b><span>${escapeHTML(course.title || 'Curso sem título')} · ${escapeHTML(attempt.quizTitle || 'Atividade')}</span></div><div class="teacher-data-meta"><span class="result-score ${percent < 60 ? 'low' : ''}">${score}/${total} · ${percent}%</span><small>${escapeHTML(studentDateLabel(attempt.submittedAt))}</small></div><button class="course-action" type="button" data-open-course-results="${escapeHTML(course.id)}">Ver resultados do curso</button></article>`;
  }).join('') : '<div class="learning-empty"><strong>Nenhuma tentativa registrada</strong>Os resultados aparecerão aqui quando alunos concluírem atividades dos seus cursos.</div>';
}

async function loadStudentRanking() {
  const list = document.querySelector('#student-ranking-list');
  const position = document.querySelector('#student-ranking-position');
  list.innerHTML = '<div class="learning-empty">Carregando ranking...</div>';
  position.textContent = 'Carregando ranking...';
  try {
    const ownRef = doc(db, 'rankingOwners', currentUser.uid);
    const ownSnapshot = await getDoc(ownRef);
    const points = ownSnapshot.exists() ? Math.max(0, Number(ownSnapshot.data().points) || 0) : 0;
    const rankingQuery = query(collection(db, 'rankings'), where('points', '>', 0), orderBy('points', 'desc'), limit(10));
    const topSnapshot = await getDocs(rankingQuery);
    const listed = topSnapshot.docs.map((entry) => {
      const item = entry.data();
      return { name: item.studentName || 'Aluno', points: Math.max(0, Number(item.points) || 0) };
    });
    const higher = points > 0
      ? (await getCountFromServer(query(collection(db, 'rankings'), where('points', '>', points)))).data().count
      : 0;
    let place = 0;
    const leaderboard = listed.map((entry, index) => {
      if (index === 0 || listed[index - 1].points !== entry.points) place = index + 1;
      return { ...entry, position: place };
    });
    studentRanking = {
      leaderboard,
      yourPosition: { points, position: points > 0 ? higher + 1 : null }
    };
    document.querySelector('#student-points').textContent = String(studentRanking.yourPosition?.points ?? 0);
    window.dispatchEvent(new CustomEvent('eduspace:ranking', { detail: { points: studentRanking.yourPosition?.points ?? 0 } }));
    position.innerHTML = studentRanking.yourPosition?.position
      ? `<b>Sua posição</b><strong>${studentRanking.yourPosition.position}º lugar</strong><span>${studentRanking.yourPosition.points} ${studentRanking.yourPosition.points === 1 ? 'ponto' : 'pontos'}</span>`
      : '<b>Sua posição</b><span>Você ainda não conquistou pontos em testes.</span>';
    const entries = studentRanking.leaderboard || [];
    list.innerHTML = entries.length ? entries.map((entry, index) => leaderboardRow(entry, index)).join('') : '<div class="learning-empty"><strong>Os alunos ainda não conquistaram pontos em testes.</strong>Conclua um teste e acerte questões para aparecer no ranking.</div>';
  } catch (error) {
    console.error('[EduSpace] falha ao carregar ranking', { code: error?.code || 'unknown' });
    studentRanking = null;
    window.dispatchEvent(new CustomEvent('eduspace:ranking', { detail: { points: null } }));
    list.innerHTML = '<div class="learning-empty">Não foi possível carregar o ranking.</div>';
    position.textContent = 'Não foi possível carregar o ranking.';
    document.querySelector('#student-points').textContent = '—';
  }
}

function leaderboardRow(entry, index) {
  const position = Number(entry.position) || index + 1;
  const medal = position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : `${position}º`;
  const photoURL = /^https:\/\//i.test(entry.photoURL || '') ? entry.photoURL : '';
  const initial = escapeHTML((entry.name || 'A').trim().charAt(0).toLocaleUpperCase('pt-BR'));
  return `<article class="leaderboard-row ${position <= 3 ? `is-top-${position}` : ''}"><span class="leaderboard-place">${medal}</span><span class="leaderboard-avatar">${photoURL ? `<img src="${escapeHTML(photoURL)}" alt="">` : initial}</span><b class="leaderboard-name">${escapeHTML(entry.name || 'Aluno')}</b><strong class="leaderboard-points">${Number(entry.points) || 0} <small>pontos</small></strong></article>`;
}

function teacherCourseCard(course) {
  const title = escapeHTML(course.title || 'Curso sem título');
  const subject = escapeHTML(course.subject || 'Geral');
  const description = escapeHTML(course.description || 'Sem descrição.');
  return `<article class="learning-course"><div class="course-topline"><span class="course-subject">${subject}</span><span class="course-state ${course.published ? 'published' : ''}">${course.published ? 'PUBLICADO' : 'RASCUNHO'}</span></div><h3>${title}</h3><p>${description}</p><div class="course-meta"><span>✦ ${course.quizCount} atividade${course.quizCount === 1 ? '' : 's'}</span><span>♙ ${course.studentCount} aluno${course.studentCount === 1 ? '' : 's'}</span><span>◷ ${dateLabel(course.createdAt)}</span></div><div class="course-actions"><button class="course-action primary" type="button" data-course-action="manage" data-course-id="${course.id}">Gerenciar curso</button><button class="course-action ${course.published ? '' : 'primary'}" type="button" data-course-action="publish" data-course-id="${course.id}">${course.published ? 'Despublicar' : 'Publicar curso'}</button></div></article>`;
}

async function openTeacherCourse(course) {
  activeQuizCourse = course;
  const dialog = document.querySelector('#course-manager-dialog');
  const content = document.querySelector('#course-manager-content');
  document.querySelector('#course-manager-title').textContent = course.title || 'Gerenciar curso';
  content.innerHTML = '<div class="learning-empty">Carregando conteúdos e atividades...</div>';
  if (!dialog.open) dialog.showModal();
  try {
    const [quizSnapshot, enrollmentSnapshot] = await Promise.all([
      getDocs(collection(db, 'courses', course.id, 'quizzes')),
      getDocs(query(collection(db, 'enrollments'), where('courseId', '==', course.id)))
    ]);
    const quizzes = quizSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    const text = course.content?.trim();
    content.innerHTML = `<section class="course-manager-overview"><span class="course-state ${course.published ? 'published' : ''}">${course.published ? 'PUBLICADO' : 'RASCUNHO'}</span><p>${escapeHTML(course.description || 'Sem descrição.')}</p><div class="course-meta"><span>Professor: ${escapeHTML(course.teacherName || profile?.nome || 'Professor')}</span><span>${text ? '1 conteúdo' : 'Sem conteúdo'}</span><span>${quizzes.length} atividade${quizzes.length === 1 ? '' : 's'}</span><span>${enrollmentSnapshot.size} aluno${enrollmentSnapshot.size === 1 ? '' : 's'}</span></div><div class="course-manager-actions"><button class="course-action" type="button" data-course-action="edit-content" data-course-id="${escapeHTML(course.id)}">Editar curso e conteúdo</button><button class="course-action primary" type="button" data-course-action="quiz" data-course-id="${escapeHTML(course.id)}">＋ Criar atividade</button><button class="course-action" type="button" data-course-action="results" data-course-id="${escapeHTML(course.id)}">Ver resultados</button><button class="course-action" type="button" data-course-action="preview" data-course-id="${escapeHTML(course.id)}">Visualizar curso</button></div></section><section class="course-manager-section"><div class="learning-panel-heading"><div><span class="eyebrow">CONTEÚDO</span><h3>Material do curso</h3></div></div>${text ? `<article class="course-manager-content-preview" tabindex="-1">${escapeHTML(text)}</article>` : '<div class="learning-empty">Este curso ainda não possui conteúdos.</div>'}</section><section class="course-manager-section"><div class="learning-panel-heading"><div><span class="eyebrow">ATIVIDADES</span><h3>Quizzes do curso</h3></div></div><div class="course-manager-quiz-list">${quizzes.length ? quizzes.map((quiz) => `<article class="quiz-list-item"><div><b>${escapeHTML(quiz.title || 'Atividade')}</b><small>${quiz.questions?.length || 0} perguntas · ${quiz.published ? 'Publicada' : 'Rascunho'}</small></div><div class="course-actions"><button class="course-action" type="button" data-manager-action="edit-quiz" data-quiz-id="${escapeHTML(quiz.id)}">Editar</button><button class="course-action danger-action" type="button" data-manager-action="delete-quiz" data-quiz-id="${escapeHTML(quiz.id)}" data-quiz-title="${escapeHTML(quiz.title || 'atividade')}">Excluir</button></div></article>`).join('') : '<div class="learning-empty">O professor ainda não adicionou atividades.</div>'}</div></section>`;
  } catch (error) {
    console.error('[EduSpace] falha ao carregar gerenciamento do curso', { code: error?.code || 'unknown' });
    content.innerHTML = '<div class="learning-empty">Não foi possível carregar este curso. Tente novamente.</div>';
  }
}

async function showCourseResults(course) {
  const dialog = document.querySelector('#results-dialog');
  document.querySelector('#results-course-name').textContent = course.title;
  const container = document.querySelector('#course-results');
  container.innerHTML = '<div class="learning-empty">Carregando resultados...</div>';
  dialog.showModal();
  try {
    const snapshot = await getDocs(query(collection(db, 'attempts'), where('courseId', '==', course.id)));
    const attempts = snapshot.docs.map((resultDoc) => resultDoc.data()).sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0));
    container.innerHTML = attempts.length ? attempts.map((attempt) => {
      const score = Number(attempt.score || 0);
      const total = Number(attempt.total || 0);
      const percent = total ? Math.round(score / total * 100) : 0;
      const points = Number.isInteger(attempt.points) ? `${attempt.points} ${attempt.points === 1 ? 'ponto' : 'pontos'}` : 'Pontos não registrados';
      return `<article class="result-row"><div><b>${escapeHTML(attempt.studentName || 'Aluno')}</b><small>${escapeHTML(attempt.studentEmail || '')}</small></div><div><b>${escapeHTML(attempt.quizTitle || 'Quiz')}</b><small>${dateLabel(attempt.submittedAt)} · ${points}</small></div><span class="result-score ${percent < 60 ? 'low' : ''}">${score}/${total} · ${percent}%</span></article>`;
    }).join('') : '<div class="learning-empty"><strong>Nenhuma tentativa por enquanto</strong>Os resultados aparecerão aqui quando os alunos concluírem um quiz.</div>';
  } catch (error) {
    container.innerHTML = '<div class="learning-empty">Não foi possível carregar os resultados.</div>';
    displayMessage(firestoreError(error, 'Falha ao consultar as tentativas.'));
  }
}

if (role === 'aluno') {
  document.querySelector('#refresh-student').addEventListener('click', loadStudentDashboard);
  document.querySelector('#student-course-search')?.addEventListener('input', () => renderStudentCourses());
  document.body.addEventListener('click', (event) => {
    if (event.target.closest('[data-retry-student]')) loadStudentDashboard();
  });
  document.querySelector('#student-courses').addEventListener('click', (event) => {
    const button = event.target.closest('[data-open-course]');
    if (button) openStudentCourse(button.dataset.openCourse);
  });
  document.querySelector('#available-courses').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-enroll-course]');
    if (!button || !currentUser) return;
    const course = studentCourses.find((item) => item.id === button.dataset.enrollCourse);
    if (!course) return;
    setButtonBusy(button, true, 'Inscrevendo…');
    try {
      await setDoc(doc(db, 'enrollments', `${currentUser.uid}_${course.id}`), { studentId: currentUser.uid, courseId: course.id, createdAt: serverTimestamp() });
      enrolledCourseIds.add(course.id);
      displayMessage(`Inscrição realizada no curso “${course.title}”.`, 'success');
      await loadStudentDashboard();
      openStudentCourse(course.id);
    } catch (error) { displayMessage(firestoreError(error, 'Não foi possível fazer a inscrição.')); }
    finally { setButtonBusy(button, false); }
  });
  document.querySelector('#student-dialog-content').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-course-tab]');
    if (tab) {
      const content = document.querySelector('#student-dialog-content');
      content.querySelectorAll('[data-course-tab]').forEach((item) => {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
        const panel = content.querySelector(`[role="tabpanel"][aria-labelledby="${item.id}"]`);
        if (panel) panel.hidden = !selected;
      });
      return;
    }
    const button = event.target.closest('[data-start-quiz]');
    if (button) startStudentQuiz(button.dataset.courseId, button.dataset.quizId);
  });
  document.querySelector('#student-pending-activities').addEventListener('click', (event) => {
    const button = event.target.closest('[data-pending-quiz]');
    if (button) startStudentQuiz(button.dataset.courseId, button.dataset.quizId);
  });
  document.querySelector('#student-corrections-content').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view-correction]');
    if (button) loadStudentCorrection(button);
  });
  document.querySelector('#student-dialog-content').addEventListener('submit', submitQuiz);
}

async function loadStudentDashboard() {
  if (!currentUser) return;
  const searchInput = document.querySelector('#student-course-search');
  if (searchInput) searchInput.disabled = true;
  const ids = ['student-courses', 'available-courses', 'student-pending-activities', 'student-results', 'student-corrections-content', 'student-continue-content', 'student-performance-content'];
  const messages = ['Carregando seus cursos...', 'Carregando cursos...', 'Carregando suas atividades...', 'Carregando atividades recentes...', 'Carregando correções...', 'Carregando seus cursos...', 'Carregando seu desempenho...'];
  ids.forEach((id, index) => { document.getElementById(id).innerHTML = `<div class="learning-empty">${messages[index]}</div>`; });
  for (const id of ['student-course-count', 'student-pending-count', 'student-attempt-count', 'student-average']) document.getElementById(id).textContent = '—';
  clearMessage();
  try {
    const [enrollmentSnapshot, courseSnapshot, attemptSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'enrollments'), where('studentId', '==', currentUser.uid))),
      getDocs(query(collection(db, 'courses'), where('published', '==', true))),
      getDocs(query(collection(db, 'attempts'), where('studentId', '==', currentUser.uid)))
    ]);
    const enrollmentByCourse = new Map(enrollmentSnapshot.docs.map((entry) => [entry.data().courseId, entry.data()]));
    enrolledCourseIds = new Set(enrollmentByCourse.keys());
    const courses = courseSnapshot.docs.map((courseDoc) => ({ id: courseDoc.id, ...courseDoc.data() }));
    const enrolledCourses = courses.filter((course) => enrolledCourseIds.has(course.id));
    const quizSnapshots = await Promise.all(enrolledCourses.map((course) => getDocs(query(
      collection(db, 'courses', course.id, 'quizzes'), where('published', '==', true), where('answerKeyVersion', '==', 2)
    ))));
    studentQuizzesByCourse = new Map(enrolledCourses.map((course, index) => [course.id,
      quizSnapshots[index].docs.map((quizDoc) => ({ id: quizDoc.id, ...quizDoc.data() }))
    ]));
    const enrolledById = new Map(enrolledCourses.map((course) => [course.id, {
      ...course, enrolledAt: enrollmentByCourse.get(course.id)?.createdAt || null,
      quizzes: studentQuizzesByCourse.get(course.id) || []
    }]));
    studentCourses = courses.map((course) => enrolledById.get(course.id) || { ...course, quizzes: [] });
    const enrolled = studentCourses.filter((course) => enrolledCourseIds.has(course.id));
    studentAttempts = attemptSnapshot.docs.map((attemptDoc) => ({ id: attemptDoc.id, ...attemptDoc.data() }))
      .filter((attempt) => !attempt.status || attempt.status === 'submitted')
      .sort((a, b) => studentTimestampMillis(b.submittedAt) - studentTimestampMillis(a.submittedAt));
    const completedKeys = new Set(studentAttempts.filter((attempt) => attempt.courseId && attempt.quizId)
      .map((attempt) => `${attempt.courseId}::${attempt.quizId}`));
    studentPendingActivities = enrolled.flatMap((course) => (course.quizzes || [])
      .filter((quiz) => !completedKeys.has(`${course.id}::${quiz.id}`))
      .map((quiz) => ({ course, quiz })));
    renderStudentCourses(completedKeys);
    if (searchInput) searchInput.disabled = false;
    renderPendingActivities(studentPendingActivities);
    const graded = studentAttempts.filter((attempt) => Number.isFinite(Number(attempt.score)) && Number(attempt.total) > 0);
    const completedCount = completedKeys.size;
    const average = graded.length ? Math.round(graded.reduce((sum, attempt) => sum + Number(attempt.score) / Number(attempt.total) * 100, 0) / graded.length) : null;
    document.querySelector('#student-course-count').textContent = enrolled.length;
    document.querySelector('#student-pending-count').textContent = studentPendingActivities.length;
    document.querySelector('#student-attempt-count').textContent = completedCount;
    document.querySelector('#student-average').textContent = average === null ? '—' : `${average}%`;
    renderStudentResults(studentAttempts);
    renderStudentCorrections(studentAttempts);
    renderContinueStudying(enrolled, studentAttempts, completedKeys);
    renderStudentPerformance({ enrolled, completedCount, pendingCount: studentPendingActivities.length, average });
  } catch (error) {
    console.error('[EduSpace] não foi possível carregar o painel do aluno', { code: error?.code || 'unknown' });
    const retry = '<button class="course-action" type="button" data-retry-student>Tentar novamente</button>';
    const state = (message) => `<div class="learning-empty student-load-error"><strong>${message}</strong>${retry}</div>`;
    document.querySelector('#student-courses').innerHTML = state('Não foi possível carregar seus cursos.');
    document.querySelector('#available-courses').innerHTML = state('Não foi possível carregar os cursos disponíveis.');
    document.querySelector('#student-pending-activities').innerHTML = state('Não foi possível carregar suas atividades.');
    document.querySelector('#student-results').innerHTML = state('Não foi possível carregar suas atividades recentes.');
    document.querySelector('#student-corrections-content').innerHTML = state('Não foi possível carregar suas correções.');
    document.querySelector('#student-continue-content').innerHTML = state('Não foi possível carregar seus estudos.');
    document.querySelector('#student-performance-content').innerHTML = state('Não foi possível carregar seu desempenho.');
    displayMessage('Não foi possível carregar seus dados. Tente novamente.');
  }
}

function normalizeCourseSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function renderStudentCourses(completedKeys = new Set(studentAttempts
  .filter((attempt) => attempt.courseId && attempt.quizId)
  .map((attempt) => `${attempt.courseId}::${attempt.quizId}`))) {
  const search = normalizeCourseSearch(document.querySelector('#student-course-search')?.value);
  const matching = studentCourses.filter((course) => !search ||
    [course.title, course.subject, course.teacherName, course.description]
      .some((value) => normalizeCourseSearch(value).includes(search)));
  const enrolled = matching.filter((course) => enrolledCourseIds.has(course.id));
  const available = matching.filter((course) => !enrolledCourseIds.has(course.id));
  const noResults = '<div class="learning-empty" role="status">Nenhum curso encontrado.</div>';
  document.querySelector('#student-courses').innerHTML = enrolled.length
    ? enrolled.map((course) => studentCourseCard(course, completedKeys)).join('')
    : search ? noResults : '<div class="learning-empty"><strong>Você ainda não está matriculado em nenhum curso.</strong>Explore os cursos disponíveis abaixo para começar.</div>';
  document.querySelector('#available-courses').innerHTML = available.length
    ? available.map(availableCourseCard).join('')
    : search ? noResults : '<div class="learning-empty"><strong>Não há outros cursos publicados no momento.</strong>Novos cursos aparecerão aqui quando forem disponibilizados.</div>';
}

function courseProgress(course, completedKeys) {
  const quizzes = course.quizzes || [];
  if (!quizzes.length) return null;
  const completed = quizzes.filter((quiz) => completedKeys.has(`${course.id}::${quiz.id}`)).length;
  return { completed, total: quizzes.length, percent: Math.round(completed / quizzes.length * 100) };
}

function progressMarkup(course, completedKeys) {
  const progress = courseProgress(course, completedKeys);
  if (!progress) return '<p class="student-progress-unavailable">Progresso detalhado ainda não registrado.</p>';
  return `<div class="student-course-progress"><div><span>Atividades concluídas</span><b>${progress.completed}/${progress.total} · ${progress.percent}%</b></div><div class="student-progress-track" role="progressbar" aria-label="Atividades concluídas em ${escapeHTML(course.title || 'curso')}" aria-valuemin="0" aria-valuemax="${progress.total}" aria-valuenow="${progress.completed}"><span style="width:${progress.percent}%"></span></div></div>`;
}

function studentCourseCard(course, completedKeys) {
  const contentCount = course.content?.trim() ? 1 : 0;
  const progress = courseProgress(course, completedKeys);
  const pendingCount = Math.max(0, (course.quizzes || []).length - (progress?.completed || 0));
  const status = progress && progress.total > 0 && progress.completed >= progress.total
    ? 'Concluído'
    : progress?.completed > 0 ? 'Em andamento' : 'Ainda não iniciado';
  return `<article class="learning-course student-course-card"><div class="course-topline"><span class="course-subject">${escapeHTML(course.subject || 'Geral')}</span><span class="course-state enrolled-label">${status}</span></div><h3>${escapeHTML(course.title || 'Curso sem título')}</h3><p>${escapeHTML(course.description || 'Descrição não disponível.')}</p>${progressMarkup(course, completedKeys)}<div class="course-meta"><span>Professor: ${escapeHTML(course.teacherName || 'Não informado')}</span><span>${contentCount} ${contentCount === 1 ? 'conteúdo' : 'conteúdos'} · ${(course.quizzes || []).length} ${(course.quizzes || []).length === 1 ? 'atividade' : 'atividades'}</span><span>${pendingCount} pendente${pendingCount === 1 ? '' : 's'}</span></div><div class="course-actions student-course-actions"><button class="course-action primary" type="button" data-open-course="${escapeHTML(course.id)}">Abrir curso <span aria-hidden="true">→</span></button></div></article>`;
}

function availableCourseCard(course) {
  const contentCount = course.content?.trim() ? 1 : 0;
  return `<article class="learning-course"><div class="course-topline"><span class="course-subject">${escapeHTML(course.subject || 'Geral')}</span><span class="course-state available-label">DISPONÍVEL</span></div><h3>${escapeHTML(course.title || 'Curso sem título')}</h3><p>${escapeHTML(course.description || 'Descrição não disponível.')}</p><div class="course-meta"><span>Professor: ${escapeHTML(course.teacherName || 'Não informado')}</span><span>${contentCount} ${contentCount === 1 ? 'conteúdo' : 'conteúdos'}</span></div><div class="course-actions student-course-actions"><button class="course-action primary" type="button" data-enroll-course="${escapeHTML(course.id)}">Inscrever-se <span aria-hidden="true">→</span></button></div></article>`;
}

function renderPendingActivities(activities) {
  const container = document.querySelector('#student-pending-activities');
  container.innerHTML = activities.length ? activities.map(({ course, quiz }) => `<article class="student-activity-card"><div class="student-activity-icon" aria-hidden="true">📝</div><div class="student-activity-copy"><b>${escapeHTML(quiz.title || 'Quiz')}</b><span>${escapeHTML(course.title || 'Curso sem título')} · Quiz</span></div><span class="student-activity-status is-pending">Pendente</span><button class="course-action primary" type="button" data-pending-quiz data-course-id="${escapeHTML(course.id)}" data-quiz-id="${escapeHTML(quiz.id)}">Fazer atividade</button></article>`).join('')
    : '<div class="learning-empty"><strong>Você não possui atividades pendentes.</strong>Quando houver um quiz publicado em um curso matriculado, ele aparecerá aqui.</div>';
}

function renderStudentResults(attempts) {
  const container = document.querySelector('#student-results');
  const recent = attempts.slice(0, 8);
  container.innerHTML = recent.length ? recent.map((attempt) => {
    const total = Number(attempt.total);
    const score = Number(attempt.score);
    const graded = Number.isFinite(score) && Number.isFinite(total) && total > 0;
    const percent = graded ? Math.round(score / total * 100) : null;
    return `<article class="result-row student-recent-row"><div><b>${escapeHTML(attempt.quizTitle || 'Atividade')}</b><small>${escapeHTML(attempt.courseTitle || 'Curso não informado')}</small></div><div><b>${graded ? `Nota ${score}/${total}` : 'Resultado não disponível'}</b><small>${studentDateLabel(attempt.submittedAt)}</small></div><span class="student-activity-status ${graded ? 'is-corrected' : 'is-pending'}">${graded ? 'Corrigida' : 'Aguardando correção'}</span>${graded ? `<span class="result-score">${percent}%</span>` : ''}</article>`;
  }).join('') : '<div class="learning-empty"><strong>Nenhuma atividade realizada recentemente.</strong>As atividades enviadas aparecerão aqui.</div>';
}

function renderStudentCorrections(attempts) {
  const container = document.querySelector('#student-corrections-content');
  const corrections = attempts.filter((attempt) => attempt.courseId && attempt.quizId && Array.isArray(attempt.answers)).slice(0, 6);
  container._correctionAttempts = corrections;
  container.innerHTML = corrections.length ? corrections.map((attempt, index) => {
    const graded = Number.isFinite(Number(attempt.score)) && Number(attempt.total) > 0;
    return `<article class="student-correction-card"><div><b>${escapeHTML(attempt.quizTitle || 'Atividade')}</b><span>${escapeHTML(attempt.courseTitle || 'Curso não informado')}</span><small>${studentDateLabel(attempt.submittedAt)} · ${graded ? `Nota ${attempt.score}/${attempt.total}` : 'Resultado não disponível'}</small></div><button class="course-action" type="button" data-view-correction="${index}">Ver correção</button><div class="student-correction-detail" data-correction-target="${index}" aria-live="polite"></div></article>`;
  }).join('') : '<div class="learning-empty"><strong>Você ainda não possui correções.</strong>As correções das atividades enviadas aparecerão aqui.</div>';
}

function renderContinueStudying(enrolled, attempts, completedKeys) {
  const target = document.querySelector('#student-continue-content');
  const latest = attempts.find((attempt) => enrolled.some((course) => course.id === attempt.courseId));
  const course = latest && enrolled.find((item) => item.id === latest.courseId);
  if (!course) {
    target.innerHTML = '<div class="student-continue-empty"><p>Escolha um curso para começar seus estudos.</p><a class="course-action primary" href="#student-courses">Ver meus cursos</a></div>';
    return;
  }
  target.innerHTML = `<div class="student-continue-course"><div class="course-topline"><span class="course-subject">${escapeHTML(course.subject || 'Curso')}</span><span class="student-activity-status is-corrected">Em andamento</span></div><h3>${escapeHTML(course.title || 'Curso sem título')}</h3><p>Professor: ${escapeHTML(course.teacherName || 'Não informado')}</p><p class="student-last-content">Última atividade registrada: “${escapeHTML(latest.quizTitle || 'Quiz')}” · ${studentDateLabel(latest.submittedAt)}</p>${progressMarkup(course, completedKeys)}<button class="course-action primary" type="button" data-continue-course="${escapeHTML(course.id)}">Continuar estudando</button></div>`;
  target.querySelector('[data-continue-course]').addEventListener('click', (event) => openStudentCourse(event.currentTarget.dataset.continueCourse));
}

function renderStudentPerformance({ enrolled, completedCount, pendingCount, average }) {
  const points = studentRanking ? (studentRanking.yourPosition?.points ?? 0) : '—';
  document.querySelector('#student-performance-content').innerHTML = `<dl class="student-performance-list"><div><dt>Pontos nos testes</dt><dd>${points}</dd></div><div><dt>Atividades concluídas</dt><dd>${completedCount}</dd></div><div><dt>Atividades pendentes</dt><dd>${pendingCount}</dd></div><div><dt>Média nas tentativas corrigidas</dt><dd>${average === null ? '—' : `${average}%`}</dd></div><div><dt>Cursos matriculados/em andamento</dt><dd>${enrolled.length}</dd></div><div><dt>Cursos concluídos</dt><dd>Não registrado</dd></div></dl>`;
}

async function openStudentCourse(courseId) {
  const course = studentCourses.find((item) => item.id === courseId);
  if (!course) return;
  const dialog = document.querySelector('#student-dialog');
  const content = document.querySelector('#student-dialog-content');
  document.querySelector('#student-dialog-title').textContent = course.title || 'Curso';
  document.querySelector('#student-dialog-description').textContent = `${course.subject || 'Curso'} · Professor: ${course.teacherName || 'Não informado'} · ${course.description || ''}`;
  content.innerHTML = '<div class="learning-empty">Carregando o conteúdo do curso...</div>';
  dialog.showModal();
  try {
    let quizzes = studentQuizzesByCourse.get(course.id);
    if (!quizzes) {
      const snapshot = await getDocs(query(collection(db, 'courses', course.id, 'quizzes'), where('published', '==', true), where('answerKeyVersion', '==', 2)));
      quizzes = snapshot.docs.map((quizDoc) => ({ id: quizDoc.id, ...quizDoc.data() }));
      studentQuizzesByCourse.set(course.id, quizzes);
    }
    const lesson = course.content?.trim();
    const completedKeys = new Set(studentAttempts.filter((attempt) => attempt.courseId && attempt.quizId).map((attempt) => `${attempt.courseId}::${attempt.quizId}`));
    const progress = courseProgress(course, completedKeys);
    content.innerHTML = `<div class="course-content-tabs" role="tablist" aria-label="Seções do curso"><button type="button" role="tab" id="course-tab-overview" data-course-tab="overview" aria-controls="course-panel-overview" aria-selected="true">Visão geral</button><button type="button" role="tab" id="course-tab-content" data-course-tab="content" aria-controls="course-panel-content" aria-selected="false" tabindex="-1">Conteúdos</button><button type="button" role="tab" id="course-tab-activities" data-course-tab="activities" aria-controls="course-panel-activities" aria-selected="false" tabindex="-1">Atividades</button></div><section id="course-panel-overview" class="course-content-panel" role="tabpanel" aria-labelledby="course-tab-overview"><h3>Sobre este curso</h3><p>${escapeHTML(course.description || 'Descrição não disponível.')}</p>${progress ? progressMarkup(course, completedKeys) : '<p class="student-progress-unavailable">O progresso aparecerá quando houver atividades registradas.</p>'}<div class="course-meta"><span>Professor: ${escapeHTML(course.teacherName || 'Não informado')}</span><span>${lesson ? '1 conteúdo' : 'Sem conteúdo'}</span><span>${quizzes.length} atividade${quizzes.length === 1 ? '' : 's'}</span></div></section><section id="course-panel-content" class="course-content-panel" role="tabpanel" aria-labelledby="course-tab-content" hidden><article class="course-lesson"><span class="eyebrow">📖 TEXTO DO CURSO</span><h3>${escapeHTML(course.title || 'Conteúdo')}</h3><div class="lesson-text">${lesson ? escapeHTML(lesson) : '<p class="student-progress-unavailable">Este curso ainda não possui conteúdos publicados.</p>'}</div></article></section><section id="course-panel-activities" class="course-content-panel" role="tabpanel" aria-labelledby="course-tab-activities" hidden>${quizzes.length ? `<div class="test-section-heading"><span class="eyebrow">📝 ATIVIDADES</span><h3>Quizzes</h3><p>Responda aos quizzes publicados para acompanhar seus resultados.</p></div><div class="quiz-list">${quizzes.map((quiz) => `<article class="quiz-list-item"><div><b>${escapeHTML(quiz.title || 'Teste final')}</b><small>❓ Questionário · ${quiz.questions?.length || 0} perguntas</small></div><button class="course-action primary" type="button" data-start-quiz data-course-id="${escapeHTML(course.id)}" data-quiz-id="${escapeHTML(quiz.id)}">Começar atividade</button></article>`).join('')}</div>` : '<div class="learning-empty"><strong>O professor ainda não adicionou atividades.</strong>Este curso ainda não possui quizzes publicados.</div>'}</section>`;
  } catch (error) {
    console.error('[EduSpace] falha ao abrir o curso do aluno', { code: error?.code || 'unknown' });
    content.innerHTML = '<div class="learning-empty"><strong>Não foi possível abrir este curso.</strong>Confira sua conexão e tente novamente.</div>';
  }
}

async function startStudentQuiz(courseId, quizId) {
  const course = studentCourses.find((item) => item.id === courseId);
  if (!course || !enrolledCourseIds.has(courseId)) return;
  document.querySelector('#student-dialog-title').textContent = course.title || 'Curso';
  document.querySelector('#student-dialog-description').textContent = `${course.subject || 'Curso'} · Professor: ${course.teacherName || 'Não informado'}`;
  const dialog = document.querySelector('#student-dialog');
  if (!dialog.open) dialog.showModal();
  await renderQuiz(course, quizId);
}

function correctionMarkup(questions, answers) {
  return questions.map((question, index) => {
    const options = Array.isArray(question.options) ? question.options : [];
    const selectedIndex = Number(answers[index]);
    const correctIndex = Number(question.correctIndex);
    if (!Number.isInteger(selectedIndex) || !Number.isInteger(correctIndex) || !options[selectedIndex] || !options[correctIndex]) {
      return `<article class="correction-item"><div class="correction-item-heading"><h4>Questão ${index + 1}</h4><span class="correction-status">Correção indisponível</span></div><p class="correction-prompt">${escapeHTML(question.prompt || 'Enunciado não disponível.')}</p></article>`;
    }
    const isCorrect = selectedIndex === correctIndex;
    return `<article class="correction-item ${isCorrect ? 'is-correct' : 'is-incorrect'}"><div class="correction-item-heading"><h4>Questão ${index + 1}</h4><span class="correction-status">${isCorrect ? '✓ Acertou' : '× Errou'}</span></div><p class="correction-prompt">${escapeHTML(question.prompt || 'Enunciado não disponível.')}</p><div class="correction-answer"><span>Sua resposta</span><b>${String.fromCharCode(65 + selectedIndex)}. ${escapeHTML(options[selectedIndex])}</b></div>${isCorrect ? '' : `<div class="correction-answer correction-answer-right"><span>Resposta correta</span><b>${String.fromCharCode(65 + correctIndex)}. ${escapeHTML(options[correctIndex])}</b></div>`}</article>`;
  }).join('');
}

async function loadStudentCorrection(button) {
  const index = Number(button.dataset.viewCorrection);
  const attempts = document.querySelector('#student-corrections-content')._correctionAttempts || [];
  const attempt = attempts[index];
  const target = button.closest('.student-correction-card')?.querySelector('[data-correction-target]');
  if (!attempt || !target) return;
  setButtonBusy(button, true, 'Carregando…');
  target.innerHTML = '<p class="learning-empty">Carregando a correção...</p>';
  try {
    const snapshot = await getDoc(doc(db, 'courses', attempt.courseId, 'quizzes', attempt.quizId));
    if (!snapshot.exists()) {
      target.innerHTML = '<p class="student-correction-unavailable">A atividade original não está mais disponível para revisar.</p>';
      return;
    }
    const questions = snapshot.data().questions;
    if (!Array.isArray(questions) || questions.length !== attempt.answers.length) {
      target.innerHTML = '<p class="student-correction-unavailable">Não foi possível relacionar as respostas à atividade original.</p>';
      return;
    }
    const keySnapshot = await getDoc(doc(db, 'courses', attempt.courseId, 'quizzes', attempt.quizId, 'answerKeys', 'correct'));
    if (!keySnapshot.exists()) throw new Error('Gabarito protegido indisponível para revisão.');
    const correctIndices = keySnapshot.data().indices;
    questions.forEach((question, questionIndex) => { question.correctIndex = correctIndices[questionIndex]; });
    target.innerHTML = `<p class="student-correction-note">As perguntas vêm da versão atualmente disponível da atividade.</p><div class="correction-list">${correctionMarkup(questions, attempt.answers)}</div>`;
    button.hidden = true;
  } catch (error) {
    console.error('[EduSpace] falha ao abrir correção do aluno', { code: error?.code || 'unknown' });
    target.innerHTML = '<p class="student-correction-unavailable">Não foi possível carregar esta correção. Confira sua conexão e tente novamente.</p>';
  } finally { setButtonBusy(button, false); }
}
async function renderQuiz(course, quizId) {
  const content = document.querySelector('#student-dialog-content');
  content.innerHTML = '<div class="learning-empty">Carregando atividade...</div>';
  try {
    const snapshot = await getDoc(doc(db, 'courses', course.id, 'quizzes', quizId));
    if (!snapshot.exists()) throw new Error('Quiz não encontrado.');
    const quiz = { id: snapshot.id, ...snapshot.data() };
    const questionsHTML = (quiz.questions || []).map((question, index) => `<fieldset class="quiz-question"><p>${index + 1}. ${escapeHTML(question.prompt)}</p>${question.options.map((option, optionIndex) => `<label class="quiz-answer"><input type="radio" name="answer-${index}" value="${optionIndex}" required><span>${escapeHTML(option)}</span></label>`).join('')}</fieldset>`).join('');
    content.innerHTML = `<form class="quiz-form" data-quiz-form data-course-id="${course.id}" data-quiz-id="${quiz.id}" data-course-title="${escapeHTML(course.title || '')}" data-quiz-title="${escapeHTML(quiz.title || '')}"><h3>${escapeHTML(quiz.title || 'Quiz')}</h3>${questionsHTML}<button class="button button-primary quiz-submit" type="submit"><span>Enviar respostas</span><span aria-hidden="true">→</span></button></form>`;
  } catch (error) {
    content.innerHTML = '<div class="learning-empty">Não foi possível abrir este quiz.</div>';
    displayMessage(firestoreError(error, 'Falha ao abrir o quiz.'));
  }
}

async function submitQuiz(event) {
  const form = event.target.closest('[data-quiz-form]');
  if (!form) return;

  event.preventDefault();

  if (!currentUser) {
    return displayMessage(
      'Sua sessão terminou. Entre novamente para enviar as respostas.'
    );
  }

  const courseId = form.dataset.courseId;
  const quizId = form.dataset.quizId;

  const course = studentCourses.find(
    (item) => item.id === courseId
  );

  const button = form.querySelector('[type="submit"]');

  setButtonBusy(button, true, 'Corrigindo…');
  clearMessage();

  try {

    // ============================
    // BUSCAR QUIZ
    // ============================

    const quizRef = doc(
      db,
      'courses',
      courseId,
      'quizzes',
      quizId
    );

    const quizSnapshot = await getDoc(quizRef);

    if (!quizSnapshot.exists()) {
      throw new Error('Quiz não encontrado.');
    }

    const quiz = quizSnapshot.data();

    const questions = Array.isArray(quiz.questions)
      ? quiz.questions
      : [];

    if (!questions.length) {
      throw new Error('Esta atividade não possui perguntas.');
    }


    // ============================
    // PEGAR RESPOSTAS DO ALUNO
    // ============================

    const formData = new FormData(form);

    const answers = questions.map((_, index) => {

      const value = formData.get(`answer-${index}`);

      if (value === null) {
        return null;
      }

      return Number(value);

    });

    if (
      answers.some(
        (answer) => !Number.isInteger(answer)
      )
    ) {
      throw new Error(
        'Responda todas as perguntas antes de enviar.'
      );
    }


    // ============================
    // BUSCAR GABARITO
    // ============================

    const keyRef = doc(
      db,
      'courses',
      courseId,
      'quizzes',
      quizId,
      'answerKeys',
      'correct'
    );

    const keySnapshot = await getDoc(keyRef);

    if (!keySnapshot.exists()) {
      throw new Error(
        'O gabarito desta atividade não foi encontrado.'
      );
    }

    const correctIndices =
      keySnapshot.data().indices;

    if (
      !Array.isArray(correctIndices) ||
      correctIndices.length !== questions.length
    ) {
      throw new Error(
        'O gabarito deste teste está incompleto.'
      );
    }


    // ============================
    // CALCULAR ACERTOS
    // ============================

    let score = 0;

    answers.forEach((answer, index) => {

      const correct =
        Number(correctIndices[index]);

      if (answer === correct) {
        score++;
      }

    });


    const total = questions.length;


    // ============================
    // IDS DO RANKING
    // ============================

    const bestId =
      `${currentUser.uid}--${courseId}--${quizId}`;

    const bestRef = doc(
      db,
      'rankingBest',
      bestId
    );

    const ownerRef = doc(
      db,
      'rankingOwners',
      currentUser.uid
    );

    const attemptRef =
      doc(collection(db, 'attempts'));


    // ============================
    // SALVAR RESULTADO
    // ============================

    const result = await runTransaction(
      db,
      async (transaction) => {

        const bestSnapshot =
          await transaction.get(bestRef);

        const ownerSnapshot =
          await transaction.get(ownerRef);


        // ----------------------------
        // MELHOR NOTA ANTERIOR
        // ----------------------------

        const previousBest =
          bestSnapshot.exists()
            ? Number(
                bestSnapshot.data().bestScore
              ) || 0
            : 0;


        // ----------------------------
        // NOVA MELHOR NOTA
        // ----------------------------

        const bestScore =
          Math.max(
            previousBest,
            score
          );


        // ----------------------------
        // QUANTOS PONTOS GANHOU
        // ----------------------------

        const pointsAdded =
          bestScore - previousBest;


        // ----------------------------
        // PONTOS ATUAIS DO ALUNO
        // ----------------------------

        const currentPoints =
          ownerSnapshot.exists()
            ? Number(
                ownerSnapshot.data().points
              ) || 0
            : 0;


        const totalPoints =
          currentPoints + pointsAdded;


        // ============================
        // RANKING ID
        // ============================

        let rankingId;

        let rankingRef;

        if (ownerSnapshot.exists()) {

          rankingId =
            ownerSnapshot.data().rankingId;

          rankingRef = doc(
            db,
            'rankings',
            rankingId
          );

          await transaction.get(
            rankingRef
          );

        } else {

          rankingRef =
            doc(collection(db, 'rankings'));

          rankingId =
            rankingRef.id;

        }


        // ============================
        // NOME DO ALUNO
        // ============================

        const displayName =
          String(
            profile?.nome ??
            currentUser.displayName ??
            'Aluno'
          );


        // ============================
        // SALVAR TENTATIVA
        // ============================

        transaction.set(
          attemptRef,
          {

            studentId:
              currentUser.uid,

            studentName:
              displayName,

            courseId,

            courseTitle:
              course?.title ||
              form.dataset.courseTitle ||
              '',

            quizId,

            quizTitle:
              quiz.title ||
              form.dataset.quizTitle ||
              '',

            answers,

            score,

            total,

            previousBest,

            bestScore,

            pointsAdded,

            submittedAt:
              serverTimestamp()

          }
        );


        // ============================
        // MELHOR NOTA DO QUIZ
        // ============================

        transaction.set(
          bestRef,
          {

            studentId:
              currentUser.uid,

            courseId,

            quizId,

            bestScore,

            previousBest,

            pointsAdded,

            attemptId:
              attemptRef.id,

            updatedAt:
              serverTimestamp()

          }
        );


        // ============================
        // TOTAL DO ALUNO
        // ============================

        transaction.set(
          ownerRef,
          {

            rankingId,

            points:
              totalPoints,

            lastBestId:
              bestId,

            lastAttemptId:
              attemptRef.id,

            updatedAt:
              serverTimestamp()

          }
        );


        // ============================
        // RANKING PÚBLICO
        // ============================

        transaction.set(
          rankingRef,
          {

            studentName:
              displayName,

            points:
              totalPoints,

            updatedAt:
              serverTimestamp()

          }
        );


        // ============================
        // LIBERAR CORREÇÃO
        // ============================

        transaction.set(
          doc(
            db,
            'courses',
            courseId,
            'quizzes',
            quizId,
            'reviewAccess',
            currentUser.uid
          ),
          {

            attemptId:
              attemptRef.id

          }
        );


        return {

          previousBest,

          bestScore,

          pointsAdded,

          totalPoints

        };

      }
    );


    // ============================
    // ATUALIZAR RANKING
    // ============================

    await loadStudentRanking();


    // ============================
    // RESULTADO
    // ============================

    const percent =
      total > 0
        ? Math.round(
            (score / total) * 100
          )
        : 0;


    const incorrect =
      total - score;


    // ============================
    // CORREÇÃO
    // ============================

    const reviewQuestions =
      questions.map(
        (question, index) => ({
          ...question,

          correctIndex:
            Number(
              correctIndices[index]
            )
        })
      );


    const reviewHTML =
      correctionMarkup(
        reviewQuestions,
        answers
      );


    // ============================
    // MENSAGEM DO RANKING
    // ============================

    let rankingMessage;

    if (result.pointsAdded > 0) {

      rankingMessage =
        `Nova melhor pontuação! +${result.pointsAdded} ${
          result.pointsAdded === 1
            ? 'ponto'
            : 'pontos'
        } no ranking.`;

    } else {

      rankingMessage =
        `Sua melhor pontuação nesta atividade continua sendo ${result.bestScore} ${
          result.bestScore === 1
            ? 'ponto'
            : 'pontos'
        }.`;

    }


    // ============================
    // MOSTRAR RESULTADO
    // ============================

    form.insertAdjacentHTML(
      'beforeend',
      `
      <section
        class="quiz-correction"
        aria-live="polite"
      >

        <div class="quiz-result-banner">

          <span>
            RESULTADO DA ATIVIDADE
          </span>

          <strong>
            ${score}/${total}
            questões corretas
            ·
            ${percent}%
          </strong>

          <div class="correction-summary">

            <span>
              ✓ ${score}
              ${score === 1
                ? 'acerto'
                : 'acertos'}
            </span>

            <span>
              🏆 ${score}
              ${score === 1
                ? 'ponto'
                : 'pontos'}
              nesta tentativa
            </span>

            <span>
              × ${incorrect}
              ${incorrect === 1
                ? 'erro'
                : 'erros'}
            </span>

          </div>

          <p>
            ${rankingMessage}

            Total no ranking:
            <strong>
              ${result.totalPoints}
              ${
                result.totalPoints === 1
                  ? 'ponto'
                  : 'pontos'
              }
            </strong>.

            Confira abaixo a correção.
          </p>

        </div>


        <div class="correction-heading">

          <h3>
            Correção detalhada
          </h3>

          <span>
            ${total}
            ${total === 1
              ? 'questão'
              : 'questões'}
          </span>

        </div>


        <div class="correction-list">
          ${reviewHTML}
        </div>

      </section>
      `
    );


    // ============================
    // BLOQUEAR SEGUNDO ENVIO
    // ============================

    button.disabled = true;


    // ============================
    // ATUALIZAR PAINEL
    // ============================

    await loadStudentDashboard();


  } catch (error) {

    console.error(
      '[EduSpace] erro ao enviar atividade',
      error
    );


    const known = [

      'Quiz não encontrado.',

      'Esta atividade não possui perguntas.',

      'Responda todas as perguntas antes de enviar.',

      'O gabarito desta atividade não foi encontrado.',

      'O gabarito deste teste está incompleto.'

    ];


    displayMessage(

      known.includes(error.message)

        ? error.message

        : firestoreError(
            error,
            'Não foi possível salvar o resultado.'
          )

    );


    button.disabled = false;


  } finally {

    if (!button.disabled) {
      setButtonBusy(
        button,
        false
      );
    }

  }
}
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog)?.close());
});



