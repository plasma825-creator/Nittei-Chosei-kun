import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getDatabase, ref, set, get, onValue, off, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB8l6n-VchEZbGp6mGhyd5qfEJhS917uxM',
  authDomain: 'nittei-chosei-kun.firebaseapp.com',
  databaseURL: 'https://nittei-chosei-kun-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'nittei-chosei-kun',
  storageBucket: 'nittei-chosei-kun.firebasestorage.app',
  messagingSenderId: '70708840746',
  appId: '1:70708840746:web:a79c3496d2226b507e7653'
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);
const $ = (id) => document.getElementById(id);

let currentId = '';
let currentEvent = null;
let currentRef = null;

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', Boolean(isError));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function makeId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join('');
}

function candidateLines() {
  return $('candidatesInput').value
    .split(String.fromCharCode(10))
    .map((line) => line.replaceAll(String.fromCharCode(13), '').trim())
    .filter(Boolean);
}

function responseKey(name) {
  return encodeURIComponent(name.trim()).replace(/[.#$\[\]\/]/g, '_');
}

function showCreateView() {
  if (currentRef) off(currentRef);
  currentRef = null;
  currentId = '';
  currentEvent = null;
  $('createView').classList.remove('hidden');
  $('eventView').classList.add('hidden');
  setStatus('新規作成');
  renderPreview();
}

function renderPreview() {
  const title = $('titleInput').value.trim() || 'イベント名';
  const memo = $('memoInput').value.trim();
  const candidates = candidateLines();

  $('previewArea').innerHTML = `
    <h2 class="event-title">${escapeHtml(title)}</h2>
    <p class="memo">${escapeHtml(memo || 'メモはありません。')}</p>
    <div class="preview-list">
      ${candidates.length
        ? candidates.map((candidate) => `<div class="preview-card"><strong>${escapeHtml(candidate)}</strong></div>`).join('')
        : '<div class="empty">候補日はまだありません。</div>'}
    </div>
  `;
}

async function createEvent() {
  const title = $('titleInput').value.trim();
  const memo = $('memoInput').value.trim();
  const candidates = candidateLines();

  if (!title) {
    alert('イベント名を入力してください。');
    return;
  }
  if (!candidates.length) {
    alert('候補日を1件以上入力してください。');
    return;
  }

  const id = makeId();
  setStatus('保存中');

  try {
    await set(ref(db, `events/${id}`), {
      title,
      memo,
      candidates,
      createdAt: serverTimestamp()
    });
    location.hash = `event=${id}`;
    await loadFromHash();
  } catch (error) {
    console.error(error);
    setStatus('保存失敗', true);
    alert('保存できませんでした。FirebaseのRulesを確認してください。');
  }
}

async function loadFromHash() {
  const match = location.hash.match(/event=([^&]+)/);
  const id = match ? decodeURIComponent(match[1]) : '';

  if (!id) {
    showCreateView();
    return;
  }

  if (currentRef) off(currentRef);
  currentId = id;
  currentRef = ref(db, `events/${id}`);
  $('createView').classList.add('hidden');
  $('eventView').classList.remove('hidden');
  setStatus('読み込み中');

  try {
    const snapshot = await get(currentRef);
    if (!snapshot.exists()) {
      currentEvent = null;
      $('eventTitle').textContent = 'イベントが見つかりません';
      $('eventMeta').textContent = '';
      $('eventMemo').textContent = '';
      $('answerArea').innerHTML = '';
      $('resultArea').innerHTML = '<div class="empty">URLを確認してください。</div>';
      $('shareUrl').value = location.href;
      setStatus('未検出', true);
      return;
    }

    onValue(currentRef, (eventSnapshot) => {
      currentEvent = eventSnapshot.val();
      renderEvent();
      setStatus('接続中');
    }, (error) => {
      console.error(error);
      setStatus('読み込み失敗', true);
    });
  } catch (error) {
    console.error(error);
    setStatus('読み込み失敗', true);
  }
}

function renderEvent() {
  if (!currentEvent) return;

  const candidates = currentEvent.candidates || [];
  const responses = currentEvent.responses || {};

  $('eventTitle').textContent = currentEvent.title || 'イベント';
  $('eventMeta').textContent = `${candidates.length}件の候補・${Object.keys(responses).length}件の回答`;
  $('eventMemo').textContent = currentEvent.memo || 'メモはありません。';
  $('shareUrl').value = location.href;

  $('answerArea').innerHTML = candidates.map((candidate, index) => `
    <div class="answer-card">
      <strong>${escapeHtml(candidate)}</strong>
      <div class="choice" role="radiogroup" aria-label="${escapeHtml(candidate)}">
        ${['○', '△', '×'].map((value) => `
          <input type="radio" id="answer-${index}-${value}" name="answer-${index}" value="${value}" ${value === '○' ? 'checked' : ''}>
          <label for="answer-${index}-${value}">${value}</label>
        `).join('')}
      </div>
    </div>
  `).join('');

  renderResults();
}

function countsFor(index) {
  const counts = { '○': 0, '△': 0, '×': 0 };

  Object.values(currentEvent.responses || {}).forEach((response) => {
    const value = response.answers && response.answers[index] ? response.answers[index] : '×';
    counts[value] = (counts[value] || 0) + 1;
  });

  return counts;
}

function mark(value) {
  const className = value === '○' ? 'ok' : value === '△' ? 'maybe' : 'no';
  return `<span class="mark ${className}">${value}</span>`;
}

function renderResults() {
  const candidates = currentEvent.candidates || [];
  const responses = Object.values(currentEvent.responses || {})
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ja'));

  const summary = candidates.map((candidate, index) => {
    const counts = countsFor(index);
    const score = counts['○'] * 2 + counts['△'];
    return { candidate, counts, score };
  }).sort((a, b) => b.score - a.score || b.counts['○'] - a.counts['○']);

  const summaryHtml = `
    <div class="summary-list">
      ${summary.map((item) => `
        <div class="summary-card">
          <strong>${escapeHtml(item.candidate)}</strong>
          <span class="counts">○ ${item.counts['○']}　△ ${item.counts['△']}　× ${item.counts['×']}</span>
        </div>
      `).join('')}
    </div>
  `;

  if (!responses.length) {
    $('resultArea').innerHTML = summaryHtml + '<div class="empty" style="margin-top:18px;">まだ回答がありません。</div>';
    return;
  }

  const rows = responses.map((response) => `
    <tr>
      <td class="name">${escapeHtml(response.name)}</td>
      ${candidates.map((_, index) => `<td>${mark((response.answers && response.answers[index]) || '×')}</td>`).join('')}
      <td class="comment">${escapeHtml(response.comment || '')}</td>
    </tr>
  `).join('');

  $('resultArea').innerHTML = summaryHtml + `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="name">名前</th>
            ${candidates.map((candidate) => `<th>${escapeHtml(candidate)}</th>`).join('')}
            <th class="comment">コメント</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

async function submitAnswer() {
  if (!currentEvent || !currentId) return;

  const name = $('nameInput').value.trim();
  const comment = $('commentInput').value.trim();

  if (!name) {
    alert('名前を入力してください。');
    return;
  }

  const answers = (currentEvent.candidates || []).map((_, index) => {
    const selected = document.querySelector(`input[name="answer-${index}"]:checked`);
    return selected ? selected.value : '×';
  });

  setStatus('保存中');

  try {
    await set(ref(db, `events/${currentId}/responses/${responseKey(name)}`), {
      name,
      comment,
      answers,
      updatedAt: serverTimestamp()
    });
    localStorage.setItem('schedule_poll_name', name);
    setStatus('保存しました');
  } catch (error) {
    console.error(error);
    setStatus('保存失敗', true);
    alert('回答を保存できませんでした。');
  }
}

async function copyUrl() {
  const url = $('shareUrl').value;

  try {
    await navigator.clipboard.writeText(url);
    setStatus('URLをコピーしました');
  } catch {
    $('shareUrl').select();
    document.execCommand('copy');
    setStatus('URLをコピーしました');
  }
}

function exportCsv() {
  if (!currentEvent) return;

  const candidates = currentEvent.candidates || [];
  const responses = Object.values(currentEvent.responses || {});
  const header = ['名前', ...candidates, 'コメント'];
  const rows = responses.map((response) => [
    response.name,
    ...candidates.map((_, index) => (response.answers && response.answers[index]) || '×'),
    response.comment || ''
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(','))
    .join(String.fromCharCode(10));

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${currentEvent.title || 'schedule'}-responses.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

$('titleInput').addEventListener('input', renderPreview);
$('memoInput').addEventListener('input', renderPreview);
$('candidatesInput').addEventListener('input', renderPreview);
$('createBtn').addEventListener('click', createEvent);
$('clearBtn').addEventListener('click', () => {
  $('titleInput').value = '';
  $('memoInput').value = '';
  $('candidatesInput').value = '';
  renderPreview();
});
$('copyBtn').addEventListener('click', copyUrl);
$('submitBtn').addEventListener('click', submitAnswer);
$('csvBtn').addEventListener('click', exportCsv);
$('newBtn').addEventListener('click', () => {
  location.hash = '';
  showCreateView();
});

window.addEventListener('hashchange', loadFromHash);

$('nameInput').value = localStorage.getItem('schedule_poll_name') || '';
renderPreview();
loadFromHash().catch((error) => {
  console.error(error);
  setStatus('初期化失敗', true);
});
