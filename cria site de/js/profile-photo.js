import { auth, db, storage } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { deleteField, doc, getDoc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const AVATARS = {
  rapaz1: { emoji: '👨🏻‍🎓', label: 'Estudante de óculos', tone: 'blue' },
  rapaz2: { emoji: '👨🏽‍💻', label: 'Estudante de tecnologia', tone: 'green' },
  rapaz3: { emoji: '👨🏾‍🔬', label: 'Estudante de ciências', tone: 'violet' },
  moca1: { emoji: '👩🏻‍🎓', label: 'Estudante de óculos', tone: 'pink' },
  moca2: { emoji: '👩🏽‍💻', label: 'Estudante de tecnologia', tone: 'orange' },
  moca3: { emoji: '👩🏾‍🔬', label: 'Estudante de ciências', tone: 'teal' }
};
const userIsAdmin = (user) => (user?.email || '').toLowerCase() === 'teste01@gmail.com';
const host = document.querySelector('.dashboard-welcome');
if (host) {
  const avatar = host.querySelector('.user-avatar, .forum-title-icon');
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'profile-photo-trigger'; trigger.textContent = 'Editar perfil'; trigger.disabled = true; host.append(trigger);
  const completion = document.createElement('p'); completion.className = 'profile-photo-status'; completion.setAttribute('aria-live', 'polite'); completion.hidden = true; trigger.insertAdjacentElement('afterend', completion);
  const dialog = document.createElement('dialog'); dialog.className = 'profile-photo-dialog';
  dialog.innerHTML = `<div class="profile-photo-dialog-head"><div><span class="eyebrow">SEU PERFIL</span><h2>Perfil da conta</h2><p class="profile-photo-hint" data-profile-details></p><p class="profile-points" data-profile-points hidden>🏆 Pontos: <b>—</b></p></div><button type="button" class="profile-photo-close" aria-label="Fechar">×</button></div><div class="profile-avatar-stage"><span></span></div><label class="profile-photo-file-label">Selecionar foto<input class="profile-photo-file" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Selecionar foto JPG, PNG ou WEBP"></label><p class="profile-photo-hint">JPG, PNG ou WEBP · até 5 MB. Ou escolha um avatar.</p><div class="profile-avatar-options" role="group" aria-label="Avatares disponíveis">${Object.entries(AVATARS).map(([id,a])=>`<button class="profile-avatar-option tone-${a.tone}" type="button" data-avatar-id="${id}" aria-label="${a.label}" aria-pressed="false"><span aria-hidden="true">${a.emoji}</span><small>${a.label}</small></button>`).join('')}</div><p class="profile-photo-message" role="status" aria-live="polite" hidden></p><div class="profile-photo-actions"><button class="button button-quiet profile-photo-remove" type="button" hidden>Usar inicial</button><button class="button button-primary profile-photo-save" type="button" disabled>Salvar perfil</button></div>`;
  document.body.append(dialog);
  const pointsLine = dialog.querySelector('[data-profile-points]');
  window.addEventListener('eduspace:ranking', (event) => {
    if (document.body.dataset.protected !== 'aluno') return;
    const points = event.detail?.points;
    pointsLine.hidden = points === null || points === undefined;
    if (!pointsLine.hidden) pointsLine.querySelector('b').textContent = String(points);
  });
  const stage=dialog.querySelector('.profile-avatar-stage'), message=dialog.querySelector('.profile-photo-message'), save=dialog.querySelector('.profile-photo-save'), remove=dialog.querySelector('.profile-photo-remove'), fileInput=dialog.querySelector('.profile-photo-file');
  let user=null, profileExists=false, currentAvatar='', currentPhoto='', pendingAvatar='', pendingPhoto=null, previewUrl='', initial='E', profileName='', profileRole='';
  function show(text,kind='error'){message.textContent=text;message.dataset.kind=kind;message.hidden=false;}
  function render(element,url,fallback,avatarId=''){
    if(!element)return; element.replaceChildren();
    if(url){const img=document.createElement('img');img.src=url;img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>{element.replaceChildren(document.createTextNode(AVATARS[avatarId]?.emoji||fallback));});element.append(img);return;}
    element.textContent=AVATARS[avatarId]?.emoji||fallback;
    element.dataset.avatarTone=AVATARS[avatarId]?.tone||'';
  }
  function apply(photo,avatarId=''){
    currentPhoto=photo||'';currentAvatar=AVATARS[avatarId]?avatarId:'';
    render(avatar,currentPhoto,initial,currentAvatar);
    document.querySelectorAll('.sidebar-avatar,.header-user-avatar').forEach(el=>render(el,currentPhoto,initial,currentAvatar));
    render(stage,currentPhoto,initial,currentAvatar);stage.dataset.avatarTone=AVATARS[currentAvatar]?.tone||'';
    dialog.querySelectorAll('.profile-avatar-option').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.avatarId===currentAvatar)));
    remove.hidden=!currentPhoto&&!currentAvatar;
    window.dispatchEvent(new CustomEvent('eduspace:profile-photo',{detail:{uid:user?.uid,url:currentPhoto,avatarId:currentAvatar}}));
  }
  function reset(){pendingAvatar='';pendingPhoto=null;fileInput.value='';if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}save.disabled=true;render(stage,currentPhoto,initial,currentAvatar);stage.dataset.avatarTone=AVATARS[currentAvatar]?.tone||'';dialog.querySelectorAll('.profile-avatar-option').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.avatarId===currentAvatar)));message.hidden=true;}
  trigger.addEventListener('click',()=>{completion.hidden=true;reset();dialog.showModal();});
  dialog.querySelector('.profile-photo-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',reset);dialog.addEventListener('close',reset);
  dialog.querySelectorAll('.profile-avatar-option').forEach(button=>button.addEventListener('click',()=>{pendingPhoto=null;fileInput.value='';pendingAvatar=button.dataset.avatarId;stage.replaceChildren(document.createTextNode(AVATARS[pendingAvatar].emoji));stage.dataset.avatarTone=AVATARS[pendingAvatar].tone;dialog.querySelectorAll('.profile-avatar-option').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));save.disabled=false;message.hidden=true;}));
  fileInput.addEventListener('change',()=>{const file=fileInput.files?.[0];if(!file)return;const allowed=['image/jpeg','image/png','image/webp'];if(!allowed.includes(file.type)){fileInput.value='';show('Escolha um arquivo JPG, PNG ou WEBP.');return;}if(file.size>5*1024*1024){fileInput.value='';show('A foto deve ter no máximo 5 MB.');return;}pendingPhoto=file;pendingAvatar='';if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);stage.replaceChildren();const preview=document.createElement('img');preview.src=previewUrl;preview.alt='Pré-visualização da foto selecionada';stage.append(preview);dialog.querySelectorAll('.profile-avatar-option').forEach(el=>el.setAttribute('aria-pressed','false'));save.disabled=false;message.hidden=true;});
  save.addEventListener('click',async()=>{
    if(!user||(!pendingAvatar&&!pendingPhoto))return;save.disabled=true;remove.disabled=true;show('Salvando perfil...','pending');
    try{if(!profileExists)throw new Error('Perfil indisponível.');if(pendingPhoto){const file=pendingPhoto;const target=ref(storage,`profilePhotos/${user.uid}/profile.jpg`);await uploadBytes(target,file,{contentType:file.type});const url=await getDownloadURL(target);await updateDoc(doc(db,'users',user.uid),{profilePhoto:url,profileAvatar:deleteField()});apply(url,'');completion.textContent='Foto de perfil atualizada.';}else{const selected=pendingAvatar;await updateDoc(doc(db,'users',user.uid),{profileAvatar:selected,profilePhoto:deleteField()});try{await deleteObject(ref(storage,`profilePhotos/${user.uid}/profile.jpg`));}catch{}apply('',selected);completion.textContent='Avatar atualizado.';}completion.hidden=false;show('Perfil salvo.','success');dialog.close();}
    catch(error){console.error('Falha ao salvar perfil:',error);show(error?.code==='permission-denied'?'A alteração foi bloqueada pelas regras do Firestore. Confira se as regras de perfil e Storage foram publicadas.':'Não foi possível salvar o perfil. Confira sua conexão.');save.disabled=false;}
    finally{remove.disabled=false;}
  });
  remove.addEventListener('click',async()=>{
    if(!user||!profileExists)return;save.disabled=true;remove.disabled=true;
    try{await updateDoc(doc(db,'users',user.uid),{profilePhoto:deleteField(),profileAvatar:deleteField()});try{await deleteObject(ref(storage,`profilePhotos/${user.uid}/profile.jpg`));}catch(storageError){if(storageError?.code!=='storage/object-not-found')console.warn('A foto antiga não pôde ser removida do Storage.',storageError?.code||'unknown');}apply('');completion.textContent='Foto removida; sua inicial será exibida.';completion.hidden=false;show('Foto removida.','success');dialog.close();}
    catch(error){console.error('Falha ao remover avatar:',error);show('Não foi possível remover o avatar. Confira as regras do Firestore.');}
    finally{remove.disabled=false;save.disabled=!pendingAvatar;}
  });
  onAuthStateChanged(auth,async signedUser=>{
    if(!signedUser){trigger.disabled=true;return;}user=signedUser;initial=(signedUser.displayName||'X-EDU+').trim().charAt(0).toLocaleUpperCase('pt-BR')||'E';
    try{const snapshot=await getDoc(doc(db,'users',signedUser.uid));profileExists=snapshot.exists();const profile=profileExists?snapshot.data():{};if(!profileExists&&!userIsAdmin(signedUser)){completion.textContent='Não foi possível localizar o perfil desta conta.';completion.hidden=false;return;}profileName=profile.nome||signedUser.displayName||'Usuário';profileRole=({aluno:'Aluno',professor:'Professor',admin:'Administrador'})[profile.tipo]||(userIsAdmin(signedUser)?'Administrador':'Conta');dialog.querySelector('[data-profile-details]').textContent=`${profileName} · ${signedUser.email||''} · ${profileRole}`;initial=profileName.trim().charAt(0).toLocaleUpperCase('pt-BR')||'E';apply(profile.profilePhoto||(profile.profileAvatar?'':signedUser.photoURL||''),profile.profileAvatar||'');trigger.disabled=!profileExists;}
    catch(error){console.error('Falha ao carregar perfil:',error);}
  });
}



