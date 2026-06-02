if (!token) {
  window.location.href = '/';
}

const NOTIFICATION_SOUND_URL = '/static/sounds/oh-oh-icq-sound.mp3';

let me = null;
let selectedUser = null;
let selectedGroup = null;
let socket = null;
let notificationAudio = null;
let typingStopTimer = null;
let typingIndicatorTimer = null;
let typingActive = false;
let usersCache = [];
let groupsCache = [];
let replyToMessage = null;
let openedMenuMessage = null;

const unreadByUser = {};
const activeChatByUser = {};
const previewByUser = {};

const appScreen = document.getElementById('appScreen');
const userList = document.getElementById('userList');
const messages = document.getElementById('messages');
const messageMenu = document.getElementById('messageMenu');
const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
const messageForm = document.getElementById('messageForm');
const messageText = document.getElementById('messageText');
const typingIndicator = document.getElementById('typingIndicator');
const avatarInput = document.getElementById('avatarInput');
const messageImageInput = document.getElementById('messageImageInput');
const contactSearch = document.getElementById('contactSearch');
const chatPeerAvatar = document.getElementById('chatPeerAvatar');
const chatStatus = document.getElementById('chatStatus');
const addGroupMembersBtn = document.getElementById('addGroupMembersBtn');
const replyPreview = document.getElementById('replyPreview');
const replyPreviewText = document.getElementById('replyPreviewText');
const clearReplyBtn = document.getElementById('clearReplyBtn');
const mePublicId = document.getElementById('mePublicId');
const toggleFindUserBtn = document.getElementById('toggleFindUserBtn');
const findUserPanel = document.getElementById('findUserPanel');
const findUserIdInput = document.getElementById('findUserIdInput');
const findUserBtn = document.getElementById('findUserBtn');
const findUserResult = document.getElementById('findUserResult');
const toggleCreateGroupBtn = document.getElementById('toggleCreateGroupBtn');
const groupModal = document.getElementById('groupModal');
const createGroupPanel = document.getElementById('createGroupPanel');
const groupTitleInput = document.getElementById('groupTitleInput');
const groupAvatarBtn = document.getElementById('groupAvatarBtn');
const groupAvatarInput = document.getElementById('groupAvatarInput');
const groupAvatarName = document.getElementById('groupAvatarName');
const groupMembersList = document.getElementById('groupMembersList');
const createGroupMessage = document.getElementById('createGroupMessage');
const closeGroupModalBtn = document.getElementById('closeGroupModalBtn');
const cancelGroupBtn = document.getElementById('cancelGroupBtn');
const addMembersModal = document.getElementById('addMembersModal');
const addMembersPanel = document.getElementById('addMembersPanel');
const addMembersList = document.getElementById('addMembersList');
const addMembersMessage = document.getElementById('addMembersMessage');
const closeAddMembersModalBtn = document.getElementById('closeAddMembersModalBtn');
const cancelAddMembersBtn = document.getElementById('cancelAddMembersBtn');

const REPLY_PREFIX = '↪ ';

function formatFileSize(bytes) {
  if (!bytes) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function showAppMessage(message = '', type = 'error') {
  const chatError = document.getElementById('chatError');
  chatError.className = `${type} chat-error`;
  chatError.textContent = message;
}

function avatarInitial(user) {
  const name = user && (user.username || user.title);
  return (name ? name.trim()[0] : '?').toUpperCase();
}

function renderAvatar(target, user, className = '') {
  if (!target) return;

  target.className = className || target.className;
  target.innerHTML = '';

  if (user && user.avatar_url) {
    const img = document.createElement('img');
    img.src = user.avatar_url;
    img.alt = user.username || user.title || '';
    target.appendChild(img);
    return;
  }

  target.textContent = avatarInitial(user);
}

function formatTime(value) {
  if (!value) return 'сейчас';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isMessagesNearBottom() {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 96;
}

function scrollMessagesToBottom() {
  messages.scrollTop = messages.scrollHeight;
  updateScrollButton();
}

function updateScrollButton() {
  if (!scrollToBottomBtn) return;
  scrollToBottomBtn.classList.toggle('hidden', (!selectedUser && !selectedGroup) || isMessagesNearBottom());
}

function splitReplyText(text = '') {
  if (!text.startsWith(REPLY_PREFIX)) {
    return { reply: null, body: text };
  }

  const separator = text.indexOf('\n\n');
  if (separator === -1) {
    return { reply: null, body: text };
  }

  const replyLine = text.slice(REPLY_PREFIX.length, separator);
  const body = text.slice(separator + 2);
  const divider = replyLine.indexOf(': ');

  if (divider === -1 || !body.trim()) {
    return { reply: null, body: text };
  }

  return {
    reply: {
      author: replyLine.slice(0, divider),
      text: replyLine.slice(divider + 2),
    },
    body,
  };
}

function messageSnippet(message) {
  if (message.file_url && !message.image_url) return `Файл: ${message.file_name || 'вложение'}`;
  if (message.image_url) return 'Изображение';
  const parsed = splitReplyText(message.text || '');
  return (parsed.body || message.text || 'Сообщение').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function messageAuthor(message) {
  if (selectedGroup) return message.sender_username || 'Участник';
  return message.sender_id === me.id ? me.username : selectedUser.username;
}

function updateReplyPreview() {
  if (!replyToMessage) {
    replyPreview.classList.add('hidden');
    replyPreviewText.textContent = '';
    document.querySelectorAll('.message.reply-source').forEach(item => item.classList.remove('reply-source'));
    return;
  }

  replyPreviewText.textContent = `${replyToMessage.author}: ${replyToMessage.snippet}`;
  replyPreview.classList.remove('hidden');
  document.querySelectorAll('.message.reply-source').forEach(item => {
    item.classList.toggle('reply-source', Number(item.dataset.messageId) === replyToMessage.id);
  });
}

function selectReplyMessage(message) {
  replyToMessage = {
    id: message.id,
    author: messageAuthor(message),
    snippet: messageSnippet(message),
  };
  updateReplyPreview();
  messageText.focus();
}

function clearReply() {
  replyToMessage = null;
  updateReplyPreview();
}

function closeMessageMenu() {
  openedMenuMessage = null;
  if (messageMenu) {
    messageMenu.classList.add('hidden');
    messageMenu.innerHTML = '';
  }
  document.querySelectorAll('.message.menu-source').forEach(item => item.classList.remove('menu-source'));
}

function addMenuButton(label, handler, danger = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = danger ? 'message-menu-item danger' : 'message-menu-item';
  button.textContent = label;
  button.addEventListener('click', event => {
    event.stopPropagation();
    closeMessageMenu();
    handler();
  });
  messageMenu.appendChild(button);
}

function openMessageMenu(message, item) {
  if (!messageMenu || message.deleted_at) return;

  openedMenuMessage = message;
  messageMenu.innerHTML = '';
  document.querySelectorAll('.message.menu-source').forEach(node => node.classList.remove('menu-source'));
  item.classList.add('menu-source');

  addMenuButton('Ответить', () => selectReplyMessage(message));

  if (message.sender_id === me.id) {
    if (!message.image_url && !message.file_url) {
      addMenuButton('Редактировать', () => editMessage(message));
    }
    addMenuButton('Удалить', () => deleteMessage(message), true);
  }

  const chatRect = document.querySelector('.chat').getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  messageMenu.classList.remove('hidden');

  const menuWidth = messageMenu.offsetWidth || 180;
  const menuHeight = messageMenu.offsetHeight || 132;
  const alignRight = message.sender_id === me.id;
  const left = alignRight
    ? Math.max(12, itemRect.right - chatRect.left - menuWidth)
    : Math.min(chatRect.width - menuWidth - 12, itemRect.left - chatRect.left);
  const top = Math.min(chatRect.height - menuHeight - 82, itemRect.bottom - chatRect.top + 8);

  messageMenu.style.left = `${Math.max(12, left)}px`;
  messageMenu.style.top = `${Math.max(82, top)}px`;
}

function setChatHeader(user = null) {
  const title = document.getElementById('chatTitle');
  addGroupMembersBtn.classList.toggle('hidden', !selectedGroup);

  if (!user) {
    title.textContent = 'Выберите собеседника';
    renderAvatar(chatPeerAvatar, { username: '?' }, 'user-avatar chat-peer-avatar');
    return;
  }

  title.textContent = user.username || user.title;
  renderAvatar(chatPeerAvatar, user, 'user-avatar chat-peer-avatar');
}

async function openMessenger() {
  try {
    me = await api('/api/users/me');
    document.getElementById('meName').textContent = me.username;
    document.getElementById('meEmail').textContent = me.email;
    mePublicId.textContent = 'ID: ' + me.public_id;
    renderAvatar(document.getElementById('meAvatar'), me, 'avatar');
    setChatHeader();

    await loadUsers();
    await loadGroups();
    connectWebSocket();
    renderEmptyState();
  } catch (error) {
    logout();
  }
}

function logout() {
  sendActiveChat(null);
  token = null;
  me = null;
  selectedUser = null;
  selectedGroup = null;
  localStorage.removeItem(TOKEN_KEY);

  if (socket) socket.close();
  socket = null;
  window.location.href = '/';
}

async function loadUsers() {
  usersCache = await api('/api/users');
  renderUsers();
}

async function loadGroups() {
  groupsCache = await api('/api/groups');
  renderUsers();
}

function renderUsers() {
  const query = (contactSearch && contactSearch.value ? contactSearch.value : '').trim().toLowerCase();
  const users = usersCache.filter(user => (
    user.username.toLowerCase().includes(query)
    || user.public_id.toLowerCase().includes(query)
  ));
  const groups = groupsCache.filter(group => group.title.toLowerCase().includes(query));
  userList.innerHTML = '';

  if (users.length === 0 && groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = usersCache.length === 0 && groupsCache.length === 0
      ? '<strong>Чатов пока нет</strong><span>Добавьте человека по ID или создайте группу.</span>'
      : '<strong>Контакты не найдены</strong><span>Попробуйте изменить поисковый запрос.</span>';
    userList.appendChild(empty);
    return;
  }

  groups.forEach(group => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'user group-chat';
    button.dataset.groupId = group.id;

    const avatar = document.createElement('span');
    renderAvatar(avatar, group, 'user-avatar');

    const body = document.createElement('span');
    body.className = 'user-body';

    const topRow = document.createElement('span');
    topRow.className = 'user-row';

    const name = document.createElement('span');
    name.className = 'user-name';
    const nameText = document.createElement('span');
    nameText.className = 'user-name-text';
    nameText.textContent = group.title;
    name.appendChild(nameText);

    const lastTime = document.createElement('span');
    lastTime.className = 'last-time';
    lastTime.textContent = `${group.members.length} уч.`;

    const lastMessage = document.createElement('span');
    lastMessage.className = 'last-message';
    lastMessage.textContent = 'Группа';

    topRow.append(name, lastTime);
    body.append(topRow, lastMessage);
    button.append(avatar, body);
    button.classList.toggle('active', selectedGroup && selectedGroup.id === group.id);
    button.addEventListener('click', () => selectGroup(group));
    userList.appendChild(button);
  });

  users.forEach(user => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'user';
    button.dataset.userId = user.id;

    const avatar = document.createElement('span');
    renderAvatar(avatar, user, 'user-avatar');

    const body = document.createElement('span');
    body.className = 'user-body';

    const topRow = document.createElement('span');
    topRow.className = 'user-row';

    const name = document.createElement('span');
    name.className = 'user-name';
    const presenceDot = document.createElement('span');
    presenceDot.className = 'chat-presence-dot hidden';
    presenceDot.dataset.presenceFor = user.id;
    const nameText = document.createElement('span');
    nameText.className = 'user-name-text';
    nameText.textContent = user.username;
    name.append(presenceDot, nameText);

    const lastTime = document.createElement('span');
    lastTime.className = 'last-time';
    lastTime.dataset.timeFor = user.id;
    lastTime.textContent = previewByUser[user.id] ? formatTime(previewByUser[user.id].created_at) : 'новый';

    const lastMessage = document.createElement('span');
    lastMessage.className = 'last-message';
    lastMessage.dataset.previewFor = user.id;
    lastMessage.textContent = previewByUser[user.id]
      ? previewByUser[user.id].text
      : 'Откройте чат, чтобы начать общение';

    topRow.append(name, lastTime);
    body.append(topRow, lastMessage);

    const badge = document.createElement('span');
    badge.className = 'unread-badge hidden';
    badge.dataset.badgeFor = user.id;

    button.append(avatar, body, badge);
    button.classList.toggle('active', selectedUser && selectedUser.id === user.id);
    updateUnreadBadge(user.id);
    updateChatPresence(user.id);
    button.addEventListener('click', () => selectUser(user));
    userList.appendChild(button);
  });
}

function renderFoundUser(user) {
  findUserResult.innerHTML = '';

  const found = document.createElement('div');
  found.className = 'found-user';

  const avatar = document.createElement('span');
  renderAvatar(avatar, user, 'user-avatar');

  const copy = document.createElement('div');
  copy.className = 'found-user-copy';

  const name = document.createElement('div');
  name.className = 'found-user-name';
  name.textContent = user.username;

  const id = document.createElement('div');
  id.className = 'found-user-id';
  id.textContent = 'ID: ' + user.public_id;

  copy.append(name, id);

  const addButton = document.createElement('button');
  addButton.className = 'add-contact-button';
  addButton.type = 'button';
  addButton.textContent = 'Добавить';
  addButton.addEventListener('click', () => addContact(user.public_id));

  found.append(avatar, copy, addButton);
  findUserResult.appendChild(found);
}

async function findUserById() {
  const publicId = findUserIdInput.value.trim().toUpperCase();
  if (!publicId) {
    findUserResult.textContent = 'Введите ID пользователя.';
    return;
  }

  try {
    findUserResult.textContent = 'Ищу пользователя...';
    const user = await api('/api/users/search?public_id=' + encodeURIComponent(publicId));
    renderFoundUser(user);
  } catch (error) {
    findUserResult.textContent = error.message;
  }
}

async function addContact(publicId) {
  try {
    const user = await api('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({ public_id: publicId }),
    });

    findUserResult.textContent = `${user.username} добавлен в контакты.`;
    await loadUsers();
    const freshUser = usersCache.find(item => item.id === user.id) || user;
    selectUser(freshUser);
  } catch (error) {
    findUserResult.textContent = error.message;
  }
}

function toggleFindUserPanel() {
  findUserPanel.classList.toggle('hidden');
  if (!findUserPanel.classList.contains('hidden')) {
    findUserIdInput.focus();
  }
}

async function copyPublicId() {
  if (!me || !me.public_id) return;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(me.public_id);
    } else {
      const input = document.createElement('input');
      input.value = me.public_id;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }

    mePublicId.textContent = 'ID скопирован';
    setTimeout(() => {
      if (me) mePublicId.textContent = 'ID: ' + me.public_id;
    }, 1200);
  } catch {
    mePublicId.textContent = 'Не скопировалось';
    setTimeout(() => {
      if (me) mePublicId.textContent = 'ID: ' + me.public_id;
    }, 1200);
  }
}

function renderMemberOptions(target, users, emptyText) {
  target.innerHTML = '';

  if (users.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'group-members-empty';
    empty.textContent = emptyText;
    target.appendChild(empty);
    return;
  }

  // Рисует список пользователей с чекбоксами для модальных окон групп.
  users.forEach(user => {
    const label = document.createElement('label');
    label.className = 'group-member-option';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = user.public_id;

    const avatar = document.createElement('span');
    renderAvatar(avatar, user, 'user-avatar');

    const copy = document.createElement('span');
    copy.className = 'group-member-copy';

    const name = document.createElement('strong');
    name.textContent = user.username;

    const id = document.createElement('span');
    id.textContent = 'ID: ' + user.public_id;

    copy.append(name, id);
    label.append(checkbox, avatar, copy);
    target.appendChild(label);
  });
}

function renderGroupMembersList() {
  renderMemberOptions(
    groupMembersList,
    usersCache,
    'Сначала добавьте пользователей в контакты по ID.'
  );
}

function openCreateGroupModal() {
  renderGroupMembersList();
  createGroupMessage.textContent = '';
  groupModal.classList.remove('hidden');
  groupTitleInput.focus();
}

function closeCreateGroupModal() {
  groupModal.classList.add('hidden');
  createGroupMessage.textContent = '';
}

function renderAddMembersList() {
  if (!selectedGroup) return;

  const memberIds = new Set(selectedGroup.members.map(member => member.id));
  const availableUsers = usersCache.filter(user => !memberIds.has(user.id));
  const emptyText = usersCache.length === 0
    ? 'Сначала добавьте пользователей в контакты по ID.'
    : 'Все ваши контакты уже в этой группе.';

  renderMemberOptions(addMembersList, availableUsers, emptyText);
}

function openAddMembersModal() {
  if (!selectedGroup) return;
  renderAddMembersList();
  addMembersMessage.textContent = '';
  addMembersModal.classList.remove('hidden');
}

function closeAddMembersModal() {
  addMembersModal.classList.add('hidden');
  addMembersMessage.textContent = '';
}

async function addMembersToGroup(event) {
  event.preventDefault();
  if (!selectedGroup) return;

  const publicIds = [...addMembersList.querySelectorAll('input[type="checkbox"]:checked')]
    .map(input => input.value);

  if (publicIds.length === 0) {
    addMembersMessage.textContent = 'Выберите хотя бы одного участника.';
    return;
  }

  try {
    addMembersMessage.textContent = 'Добавляю участников...';
    const group = await api('/api/groups/' + selectedGroup.id + '/members', {
      method: 'POST',
      body: JSON.stringify({ public_ids: publicIds }),
    });

    selectedGroup = group;
    await loadGroups();
    const freshGroup = groupsCache.find(item => item.id === group.id) || group;
    selectedGroup = freshGroup;
    setChatHeader(freshGroup);
    renderUsers();
    closeAddMembersModal();
  } catch (error) {
    addMembersMessage.textContent = error.message;
  }
}

async function createGroup(event) {
  event.preventDefault();

  const title = groupTitleInput.value.trim();
  const memberIds = [...groupMembersList.querySelectorAll('input[type="checkbox"]:checked')]
    .map(input => input.value)
    .join(',');

  if (!title) {
    createGroupMessage.textContent = 'Введите название группы.';
    return;
  }

  const formData = new FormData();
  formData.append('title', title);
  formData.append('member_ids', memberIds);

  if (groupAvatarInput.files[0]) {
    formData.append('avatar', groupAvatarInput.files[0]);
  }

  try {
    createGroupMessage.textContent = 'Создаю группу...';
    const group = await uploadApi('/api/groups', formData);
    createGroupMessage.textContent = 'Группа создана.';
    groupTitleInput.value = '';
    groupAvatarInput.value = '';
    groupAvatarName.textContent = 'Не выбран';
    await loadGroups();
    const freshGroup = groupsCache.find(item => item.id === group.id) || group;
    selectGroup(freshGroup);
    closeCreateGroupModal();
  } catch (error) {
    createGroupMessage.textContent = error.message;
  }
}

function selectUser(user) {
  if (selectedUser && selectedUser.id === user.id) {
    closeChat();
    return;
  }

  selectedUser = user;
  selectedGroup = null;
  clearReply();
  closeMessageMenu();
  unreadByUser[user.id] = 0;
  updateUnreadBadge(user.id);
  showAppMessage('', 'error');
  setChatHeader(user);
  typingIndicator.textContent = '';
  typingIndicator.classList.remove('active');
  appScreen.classList.add('chat-open');
  messageForm.classList.remove('hidden');

  [...document.querySelectorAll('.user')].forEach(button => {
    button.classList.toggle('active', Number(button.dataset.userId) === user.id);
  });

  sendActiveChat(user.id);
  loadMessages({ scrollToBottom: true });
}

function selectGroup(group) {
  if (selectedGroup && selectedGroup.id === group.id) {
    closeChat();
    return;
  }

  sendTyping(false);
  selectedUser = null;
  selectedGroup = group;
  clearReply();
  closeMessageMenu();
  showAppMessage('', 'error');
  setChatHeader(group);
  typingIndicator.textContent = '';
  typingIndicator.classList.remove('active');
  appScreen.classList.add('chat-open');
  messageForm.classList.remove('hidden');

  [...document.querySelectorAll('.user')].forEach(button => {
    button.classList.toggle('active', Number(button.dataset.groupId) === group.id);
  });

  sendActiveChat(null);
  loadMessages({ scrollToBottom: true });
}

function closeChat() {
  sendTyping(false);
  selectedUser = null;
  selectedGroup = null;
  clearReply();
  closeMessageMenu();
  sendActiveChat(null);
  setChatHeader();
  showAppMessage('', 'error');
  typingIndicator.textContent = '';
  typingIndicator.classList.remove('active');
  messages.innerHTML = '';
  renderEmptyState();
  updateScrollButton();
  appScreen.classList.remove('chat-open');
  messageForm.classList.add('hidden');
  document.querySelectorAll('.user').forEach(button => button.classList.remove('active'));
}

function renderEmptyState() {
  messages.innerHTML = `
    <div class="empty-state">
      <strong>Добро пожаловать в Kursach Messenger</strong>
      <span>Выберите контакт или группу, чтобы открыть чат.</span>
    </div>
  `;
}

function updateUnreadBadge(userId) {
  const badge = document.querySelector(`[data-badge-for="${userId}"]`);
  if (!badge) return;

  const count = unreadByUser[userId] || 0;
  const oldCount = Number(badge.dataset.count || 0);
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.classList.toggle('hidden', count === 0);
  badge.dataset.count = count;

  if (count > oldCount) {
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
  }
}

function updatePreview(userId, message) {
  if (!message) return;
  previewByUser[userId] = {
    text: message.file_url && !message.image_url
      ? `Файл: ${message.file_name || 'вложение'}`
      : (message.image_url ? 'Изображение' : (message.text || 'Новое сообщение')),
    created_at: message.created_at,
  };

  const preview = document.querySelector(`[data-preview-for="${userId}"]`);
  const time = document.querySelector(`[data-time-for="${userId}"]`);
  if (preview) preview.textContent = previewByUser[userId].text;
  if (time) time.textContent = formatTime(previewByUser[userId].created_at);
}

function updateChatPresence(userId) {
  const dot = document.querySelector(`[data-presence-for="${userId}"]`);
  if (dot) dot.classList.toggle('hidden', !activeChatByUser[userId]);
  if (selectedUser && selectedUser.id === userId) setChatHeader(selectedUser);
}

function sendActiveChat(withUserId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: 'active_chat', with_user_id: withUserId }));
}

function sendTyping(isTyping) {
  if (!selectedUser || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (typingActive === isTyping) return;

  typingActive = isTyping;
  socket.send(JSON.stringify({
    type: 'typing',
    to_user_id: selectedUser.id,
    typing: isTyping,
  }));
}

function handleTypingInput() {
  if (!selectedUser) return;
  sendTyping(true);
  clearTimeout(typingStopTimer);
  typingStopTimer = setTimeout(() => sendTyping(false), 1200);
}

function showTypingIndicator(fromUserId, isTyping) {
  if (!selectedUser || selectedUser.id !== fromUserId) return;

  typingIndicator.textContent = isTyping ? `${selectedUser.username} печатает...` : '';
  typingIndicator.classList.toggle('active', isTyping);
  clearTimeout(typingIndicatorTimer);

  if (isTyping) {
    typingIndicatorTimer = setTimeout(() => {
      typingIndicator.textContent = '';
      typingIndicator.classList.remove('active');
      setChatHeader(selectedUser);
    }, 1800);
  }
}

function playNotificationSound() {
  try {
    notificationAudio = notificationAudio || new Audio(NOTIFICATION_SOUND_URL);
    notificationAudio.currentTime = 0;
    notificationAudio.volume = 0.75;
    notificationAudio.play();
  } catch {
  }
}

async function loadMessages(options = {}) {
  if (!selectedUser && !selectedGroup) return;

  try {
    const shouldStickToBottom = Boolean(options.scrollToBottom) || isMessagesNearBottom();
    const previousScrollTop = messages.scrollTop;
    const list = selectedGroup
      ? await api('/api/groups/' + selectedGroup.id + '/messages')
      : await api('/api/messages?with_user_id=' + selectedUser.id);
    messages.innerHTML = '';

    if (list.length === 0) {
      messages.innerHTML = `
        <div class="empty-state">
          <strong>Начните диалог</strong>
          <span>Первое сообщение задаст тон переписке. Можно отправить текст или изображение.</span>
        </div>
      `;
    } else {
      list.forEach(addMessageToPage);
      if (selectedUser) updatePreview(selectedUser.id, list[list.length - 1]);
    }

    if (shouldStickToBottom) {
      scrollMessagesToBottom();
    } else {
      messages.scrollTop = previousScrollTop;
      updateScrollButton();
    }

    if (selectedUser) {
      await api('/api/messages/read?with_user_id=' + selectedUser.id, { method: 'POST' });
    }
  } catch (error) {
    showAppMessage(error.message, 'error');
  }
}

function addMessageToPage(message) {
  const item = document.createElement('div');
  const mine = message.sender_id === me.id;
  item.className = 'message ' + (mine ? 'mine' : 'their');
  item.dataset.messageId = message.id;
  item.addEventListener('click', event => {
    event.stopPropagation();
    openMessageMenu(message, item);
  });

  if (message.deleted_at) {
    item.classList.add('deleted');
    const deletedText = document.createElement('div');
    deletedText.className = 'message-text';
    deletedText.textContent = 'Сообщение удалено';
    item.appendChild(deletedText);
  }

  if (!message.deleted_at && message.image_url) {
    const image = document.createElement('img');
    image.className = 'message-image';
    image.src = message.image_url;
    image.alt = 'Прикрепленная картинка';
    item.appendChild(image);
  }

  if (!message.deleted_at && selectedGroup && !mine) {
    const author = document.createElement('div');
    author.className = 'message-author';
    author.textContent = message.sender_username || 'Участник';
    item.appendChild(author);
  }

  if (!message.deleted_at && message.file_url && !message.image_url) {
    const fileCard = document.createElement('a');
    fileCard.className = 'message-file';
    fileCard.href = message.file_url;
    fileCard.target = '_blank';
    fileCard.rel = 'noopener';
    fileCard.download = message.file_name || '';
    fileCard.addEventListener('click', event => event.stopPropagation());

    const fileIcon = document.createElement('span');
    fileIcon.className = 'message-file-icon';
    fileIcon.textContent = '↓';

    const fileInfo = document.createElement('span');
    fileInfo.className = 'message-file-info';

    const fileName = document.createElement('strong');
    fileName.textContent = message.file_name || 'Файл';

    const fileMeta = document.createElement('span');
    fileMeta.textContent = formatFileSize(message.file_size);

    fileInfo.append(fileName, fileMeta);
    fileCard.append(fileIcon, fileInfo);
    item.appendChild(fileCard);
  }

  if (!message.deleted_at && message.text) {
    const parsed = splitReplyText(message.text);

    if (parsed.reply) {
      const reply = document.createElement('div');
      reply.className = 'message-reply';
      reply.textContent = `${parsed.reply.author}: ${parsed.reply.text}`;
      item.appendChild(reply);
    }

    const text = document.createElement('div');
    text.className = 'message-text';
    text.textContent = parsed.body;
    item.appendChild(text);
  }

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const time = document.createElement('span');
  const editedText = message.edited_at && !message.deleted_at ? ' · изм.' : '';
  time.textContent = formatMessageTime(message.created_at) + editedText;
  meta.appendChild(time);

  if (mine && !message.deleted_at) {
    const status = document.createElement('span');
    status.className = 'read-status';
    status.textContent = message.read_at ? '✓✓' : '✓';
    status.title = message.read_at ? 'Прочитано' : 'Отправлено';
    meta.appendChild(status);
  }

  item.appendChild(meta);
  messages.appendChild(item);
}

async function editMessage(message) {
  const parsed = splitReplyText(message.text || '');
  const text = prompt('Изменить сообщение', parsed.body || message.text || '');
  if (text === null) return;

  const nextText = text.trim();
  if (!nextText) {
    showAppMessage('Сообщение не может быть пустым.', 'error');
    return;
  }

  const body = parsed.reply
    ? `${REPLY_PREFIX}${parsed.reply.author}: ${parsed.reply.text}\n\n${nextText}`
    : nextText;

  try {
    await api('/api/messages/' + message.id, {
      method: 'PATCH',
      body: JSON.stringify({ text: body }),
    });
    await loadMessages();
  } catch (error) {
    showAppMessage(error.message, 'error');
  }
}

async function deleteMessage(message) {
  if (!confirm('Удалить сообщение?')) return;

  try {
    await api('/api/messages/' + message.id, { method: 'DELETE' });
    await loadMessages();
  } catch (error) {
    showAppMessage(error.message, 'error');
  }
}

async function sendMessage(event) {
  event.preventDefault();

  const text = messageText.value.trim();
  if (!text || (!selectedUser && !selectedGroup)) return;

  const messageBody = replyToMessage
    ? `${REPLY_PREFIX}${replyToMessage.author}: ${replyToMessage.snippet}\n\n${text}`
    : text;

  try {
    sendTyping(false);
    if (selectedGroup) {
      await api('/api/groups/' + selectedGroup.id + '/messages', {
        method: 'POST',
        body: JSON.stringify({ text: messageBody }),
      });
    } else {
      await api('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ receiver_id: selectedUser.id, text: messageBody }),
      });
    }

    messageText.value = '';
    clearReply();
    await loadMessages({ scrollToBottom: true });
  } catch (error) {
    showAppMessage(error.message, 'error');
  }
}

async function uploadAvatar() {
  const file = avatarInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('avatar', file);

  try {
    showAppMessage('Загружаю аватар...', 'hint');
    me = await uploadApi('/api/users/avatar', formData);
    renderAvatar(document.getElementById('meAvatar'), me, 'avatar');
    showAppMessage('Аватар обновлен.', 'success');
  } catch (error) {
    showAppMessage(error.message, 'error');
  } finally {
    avatarInput.value = '';
  }
}

async function sendAttachedFile(file) {
  if (!file) return;
  if (selectedGroup) {
    showAppMessage('Файлы пока можно отправлять только в личные чаты.', 'error');
    return;
  }
  if (!selectedUser) {
    showAppMessage('Сначала выберите собеседника.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('receiver_id', selectedUser.id);
  formData.append('file', file);

  try {
    showAppMessage('Отправляю файл...', 'hint');
    await uploadApi('/api/messages/file', formData);
    showAppMessage('', 'error');
    await loadMessages({ scrollToBottom: true });
  } catch (error) {
    showAppMessage(error.message, 'error');
  }
}

async function sendImageMessage() {
  await sendAttachedFile(messageImageInput.files[0]);
  messageImageInput.value = '';
}

function connectWebSocket() {
  if (socket) socket.close();

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${protocol}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  socket.onopen = () => {
    document.getElementById('wsStatus').textContent = 'Онлайн';
    if (selectedUser) sendActiveChat(selectedUser.id);
  };

  socket.onclose = () => {
    document.getElementById('wsStatus').textContent = 'Не в сети';
    typingActive = false;
  };

  socket.onmessage = event => {
    let payload = {};

    try {
      payload = JSON.parse(event.data);
    } catch {
      payload = {};
    }

    if (payload.type === 'chat_presence') {
      const userId = Number(payload.user_id);
      if (userId) {
        activeChatByUser[userId] = Boolean(payload.active);
        updateChatPresence(userId);
      }
      return;
    }

    if (payload.type === 'typing') {
      showTypingIndicator(Number(payload.from_user_id), Boolean(payload.typing));
      return;
    }

    if (payload.type === 'messages_read') {
      if (selectedUser && selectedUser.id === Number(payload.by_user_id)) {
        loadMessages();
      }
      return;
    }

    if (payload.type === 'new_group_message') {
      const groupId = Number(payload.group_id);
      if (selectedGroup && selectedGroup.id === groupId) {
        loadMessages();
      } else {
        playNotificationSound();
        loadGroups();
      }
      return;
    }

    if (payload.type === 'message_updated' || payload.type === 'message_deleted') {
      const groupId = Number(payload.group_id);
      if (selectedGroup && selectedGroup.id === groupId) {
        loadMessages();
        return;
      }

      const fromUserId = Number(payload.from_user_id);
      if (selectedUser && selectedUser.id === fromUserId) {
        loadMessages();
      }
      return;
    }

    const fromUserId = Number(payload.from_user_id);

    if (selectedUser && selectedUser.id === fromUserId) {
      loadMessages();
      return;
    }

    if (fromUserId) {
      playNotificationSound();
      unreadByUser[fromUserId] = (unreadByUser[fromUserId] || 0) + 1;
      updateUnreadBadge(fromUserId);
      updatePreview(fromUserId, {
        text: payload.text || 'Новое сообщение',
        created_at: new Date().toISOString(),
      });
    }
  };
}

function setupDragAndDrop() {
  const chat = document.querySelector('.chat');

  ['dragenter', 'dragover'].forEach(eventName => {
    chat.addEventListener(eventName, event => {
      event.preventDefault();
      if (selectedUser) chat.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    chat.addEventListener(eventName, event => {
      event.preventDefault();
      if (eventName === 'dragleave' && chat.contains(event.relatedTarget)) return;
      chat.classList.remove('drag-over');
    });
  });

  chat.addEventListener('drop', event => {
    const file = [...event.dataTransfer.files][0];
    sendAttachedFile(file);
  });
}

setInterval(() => {
  if (token && selectedUser) loadMessages();
}, 4000);

document.getElementById('logoutBtn').addEventListener('click', logout);
document.getElementById('backToContactsBtn').addEventListener('click', closeChat);
document.getElementById('avatarBtn').addEventListener('click', () => avatarInput.click());
document.getElementById('attachImageBtn').addEventListener('click', () => messageImageInput.click());
if (clearReplyBtn) clearReplyBtn.addEventListener('click', clearReply);
if (scrollToBottomBtn) scrollToBottomBtn.addEventListener('click', scrollMessagesToBottom);
if (mePublicId) mePublicId.addEventListener('click', copyPublicId);
if (toggleFindUserBtn) toggleFindUserBtn.addEventListener('click', toggleFindUserPanel);
if (findUserBtn) findUserBtn.addEventListener('click', findUserById);
if (toggleCreateGroupBtn) toggleCreateGroupBtn.addEventListener('click', openCreateGroupModal);
if (closeGroupModalBtn) closeGroupModalBtn.addEventListener('click', closeCreateGroupModal);
if (cancelGroupBtn) cancelGroupBtn.addEventListener('click', closeCreateGroupModal);
if (groupModal) {
  groupModal.addEventListener('click', event => {
    if (event.target === groupModal) closeCreateGroupModal();
  });
}
if (createGroupPanel) createGroupPanel.addEventListener('submit', createGroup);
if (addGroupMembersBtn) addGroupMembersBtn.addEventListener('click', openAddMembersModal);
if (closeAddMembersModalBtn) closeAddMembersModalBtn.addEventListener('click', closeAddMembersModal);
if (cancelAddMembersBtn) cancelAddMembersBtn.addEventListener('click', closeAddMembersModal);
if (addMembersPanel) addMembersPanel.addEventListener('submit', addMembersToGroup);
if (addMembersModal) {
  addMembersModal.addEventListener('click', event => {
    if (event.target === addMembersModal) closeAddMembersModal();
  });
}
if (groupAvatarBtn) groupAvatarBtn.addEventListener('click', () => groupAvatarInput.click());
if (groupAvatarInput) {
  groupAvatarInput.addEventListener('change', () => {
    groupAvatarName.textContent = groupAvatarInput.files[0] ? groupAvatarInput.files[0].name : 'Не выбран';
  });
}
if (findUserIdInput) {
  findUserIdInput.addEventListener('input', () => {
    findUserIdInput.value = findUserIdInput.value.toUpperCase();
  });
  findUserIdInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') findUserById();
  });
}
messages.addEventListener('scroll', updateScrollButton);
document.addEventListener('click', closeMessageMenu);
if (contactSearch) contactSearch.addEventListener('input', renderUsers);
avatarInput.addEventListener('change', uploadAvatar);
messageImageInput.addEventListener('change', sendImageMessage);
messageText.addEventListener('input', handleTypingInput);
messageForm.addEventListener('submit', sendMessage);
setupDragAndDrop();

openMessenger();
