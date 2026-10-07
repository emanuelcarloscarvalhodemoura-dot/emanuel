# EduSpace

Plataforma inicial de estudos feita com HTML, CSS, JavaScript Modules e Firebase Authentication + Cloud Firestore.

## Executar localmente

Como as páginas usam módulos JavaScript, abra o projeto por um servidor local (não diretamente como `file://`). Por exemplo, no VS Code, inicie a extensão Live Server na pasta do projeto e abra `index.html`.

## Configuração do Firebase

O projeto já aponta para o aplicativo web `eduspace2` em `js/firebase-config.js`.

1. No Firebase Console, habilite Authentication → Sign-in method → E-mail/senha.
2. Crie um banco em Firestore Database.
3. Abra Firestore Database → Regras, cole o conteúdo de `firestore.rules` e publique.
4. Em Authentication → Settings → Authorized domains, confirme que o domínio usado no teste (por exemplo, `localhost`) está autorizado.

O registro cria `/users/{uid}` com os campos `nome`, `email`, `tipo` e `status`. Alunos começam com `active`; professores começam com `pending`. A conta administrativa é `teste01@gmail.com`. Entre com esse e-mail e sua senha; o painel não exige confirmação por e-mail para essa conta. O painel `admin.html` lista contas e permite aprovar professores, desativar contas e reativá-las.

## Páginas

- `index.html`: apresentação do EduSpace.
- `cadastro.html` e `login.html`: criação de conta e entrada com e-mail e senha.
- `recuperar-senha.html`: solicita um link de redefinição pelo Firebase Authentication.
- `aluno.html`: inscrição em cursos publicados, resolução de quizzes e histórico de resultados.
- `professor.html`: criação/publicação de cursos, criação de quizzes e resultados das turmas.
- `aguardando-aprovacao.html`: estado de aprovação de professor.
- `admin.html`: painel para gerenciar contas e aprovar professores.
- Perfil: avatar existente ou envio de foto JPG, PNG ou WEBP (máximo 5 MB).

## Fluxo de teste

1. Entre como `teste01@gmail.com` e aprove a conta do professor em `admin.html` (mude o status pendente para ativo).
2. Entre com a conta do professor, crie um curso e publique-o.
3. Crie um quiz com perguntas de múltipla escolha.
4. Entre como aluno em outra sessão do navegador, inscreva-se no curso e envie o quiz.
5. Veja o resultado no painel do aluno e em Resultados no painel do professor.

O navegador envia as respostas, mas as regras publicadas do Firestore conferem a pontuação contra o gabarito protegido antes de gravar a tentativa e os pontos. A conta do aluno não pode escrever diretamente uma nota diferente da validada.

## Recursos da versão 3.0

- A aprovação de um professor registra `approvedAt` no perfil. Documentos antigos continuam válidos e não precisam de migração.
- Fotos de perfil usam `profilePhotos/{uid}/profile.jpg`; `storage.rules` limita a gravação à própria conta e a 5 MB.
- O ranking 3.1 soma apenas a melhor quantidade de acertos por aluno e quiz. As regras do Firestore validam a nota, a tentativa, o melhor resultado por quiz e o acréscimo de pontos em uma gravação atômica. As entradas públicas contêm apenas nome e pontos; a associação privada entre aluno e entrada fica em `rankingOwners`.
- Como as regras não devolvem a nota calculada ao navegador, o envio testa os valores possíveis de 0 até o total de questões até que o Firestore aceite a nota correta. Isso pode fazer mais leituras no Spark; o máximo é 11 tentativas de validação por quiz de 10 questões. A correção continua sendo conferida pelas regras antes de gravar pontos.
- Esta versão não usa Cloud Functions. Para publicar a adaptação, atualize o site e publique as regras e índices: `firebase deploy --only firestore:rules,firestore:indexes --project eduspace2`. O processo não exige trocar para o plano Blaze. Depois, entre como administrador e use “Proteger gabaritos existentes” para migrar quizzes antigos; o botão agora executa a migração usando a conta administrativa do Firestore. Quizzes antigos só ficam acessíveis aos alunos depois de protegidos.
- Pontos antigos não são importados: resultados legados não guardam garantia de integridade nem versão histórica do gabarito. Os pontos começam com tentativas validadas após a publicação. Empates recebem a mesma colocação (por exemplo: 1º, 2º, 2º, 4º).

Os dados e regras de Firestore relacionados a eventos e notificações foram preservados, mas a interface atual não os utiliza. As regras do Storage já têm o caminho de foto de perfil; confirme que `storage.rules` foi publicado no projeto.

## Autenticação e acesso

O código atual implementa autenticação por e-mail e senha e recuperação de senha. Não há fluxo de login Google implementado nesta versão. O painel administrativo é validado pelas regras do Firestore no servidor; a seleção de página no frontend não concede permissões de banco por si só.
