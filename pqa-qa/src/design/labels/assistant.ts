/** Design labels used by the assistant design specs, by design board file. Filled from the AI Assistant case file
 * (DS-EXAI). */

// Each board's labels are a typed const so specs get every key as a string (a Record lookup is `string | undefined`
// under noUncheckedIndexedAccess). `labels` at the end is what src/support/design-labels.spec.ts checks.
// All ExecAIAssistant*.dc.html boards are one page in different states: a label is keyed by the base board when every
// state board carries it, by the notes board when only the notes do.

/** ExecAIAssistant.dc.html (and every ExecAIAssistant-* state board). */
export const exec = {
  aiAssistant: 'AI Assistant',
  chats: 'Chats',
  backToPortal: 'Back to portal',
  newChat: 'New chat',
  recents: 'RECENTS',
  chatLog: 'Chat',
  welcome: 'What do you want to do?',
  scopeHead: 'Answers come only from',
  scopeTail: 'replies in Parliament and our documents.',
  switchGroup: 'What to do with your question',
  generate: 'Generate reply',
  search: 'Search documents',
  searchTip: 'For any question on our documents',
  searchPh: 'Ask about anything in our documents',
  attachCompare: 'Attach new data to compare',
  attachDoc: 'Attach a document',
  yourQuestion: 'Your question',
  disclaimer: 'AI Assistant uses generative AI. Check the answer against the official document before you use it.',
  send: 'Send',
  stop: 'Stop',
  clearChat: 'Clear chat',
  remove: 'Remove',
  deleteChat: 'Delete chat',
  deleteTitle: 'Delete this chat?',
  delete: 'Delete',
  cancel: 'Cancel',
  close: 'Close',
  today: 'Today',
  yesterday: 'Yesterday',
  stopped: 'You stopped this answer.',
  skip: 'Skip to Main Content',
  textSize: 'Text size controls',
  textUp: 'Increase text size',
  textDown: 'Decrease text size',
  textReset: 'Reset text size',
  goi: 'Government of India (opens in new tab)',
  a11y: 'Accessibility options',
  language: 'Language: English',
  topUtilities: 'Top utilities',
  meity: 'Ministry of Electronics and Information Technology',
  lastUpdated: 'Last updated',
  dismiss: 'Dismiss message',
  comparing: 'Comparing the earlier reply with',
  searching: 'Searching our documents…',
  thisAnswer: 'This answer',
  copyAnswer: 'Copy answer',
  copy: 'Copy',
  download: 'Download as a Word document',
  copied: 'Answer copied.',
  downloaded: 'is downloaded.',
  replyArticle: 'Reply in the official format',
  goiCaps: 'GOVERNMENT OF INDIA',
  willMinister: 'Will the Minister of Electronics and Information Technology be pleased to state:',
  pleased: 'be pleased to state',
  statementHead: 'STATEMENT REFERRED TO IN THE REPLY TO',
  draftKind: 'New draft · earlier reply compared with',
  draftArticle: 'Draft reply in the official format',
  fillIn: 'Fill in the House, question number, date and Member before you use it.',
  houseBlank: 'LOK SABHA / RAJYA SABHA',
  fromDocs: 'From our documents',
  docsMatch: 'documents match your question',
  docMatches: 'document matches your question',
  aiSummary: 'AI summary',
  viewDoc: 'View document',
  sortBy: 'Sort results by',
  mostRelevant: 'Most relevant',
  newest: 'Newest first',
  oldest: 'Oldest first',
  qaQuestion: 'Question',
  qaAnswer: 'Answer, as given in Parliament',
  statementLaid: 'Statement laid on the Table:',
  notFoundReply: "I couldn't find this question in earlier replies.",
  notFoundReplyHint: 'Check the wording, or search our documents for a wider answer.',
  searchOurDocs: 'Search our documents',
  notFoundDocs: "This isn't in our documents.",
  notFoundDocsHint: 'If it is a question asked in Parliament, generate a reply instead.',
  generateAReply: 'Generate a reply',
  clearTitle: 'Clear this chat?',
  clearBody: "The questions and answers in this chat will be removed. You can't undo this.",
  cardGenerateWhen: 'For a question asked in Parliament',
  cardSearchWhen: 'For any other question, on a wider topic',
  cardSearchWhat: "Answers come only from our documents. If it isn't in them, you'll be told.",
  draftFile: 'Draft_reply_',
};

/** ExecAI00Notes.dc.html — copy the state boards build at run time, written out only in the notes. */
export const execNotes = {
  generatePh: 'Type the Parliament question, word for word or roughly',
  finding: 'Finding the earlier reply…',
  downloadTip: 'Download as Word',
  poweredBy: 'Powered by',
  replyGiven: 'Reply given in Parliament',
};

/** Exact case-file copy the snapshot inventory does not carry (template text its extractor missed, or names of 3
 * characters, which must match a whole inventory string). The offline check cannot prove these: they are outside
 * `labels` on purpose, kept here so there is one place to move them in when the inventory catches up. */
/** More strings from the Executive AI Assistant board, kept apart from `exec` only because the specs import them
 * under this name. They are checked against the board like `exec` (see `labels` below). */
export const execMore = {
  generateTip: 'Reply generated in the official Parliament format',
  keysHint: 'Enter sends. Shift and Enter starts a new line.',
  deleteBody: "will be removed from Recents, with its questions and answers. You can't undo this.",
  chatDeleted: 'Chat deleted.',
  chatCleared: 'Chat cleared.',
  you: 'You',
  negd: 'National e-Governance Division',
  officialKind: 'Official Parliament format',
  ministryCaps: 'MINISTRY OF ELECTRONICS AND INFORMATION TECHNOLOGY',
  questionNo: 'QUESTION NO.',
  answeredOn: 'TO BE ANSWERED ON:',
  answerHead: 'ANSWER',
  match: '% match',
  showQA: 'Show question and answer',
  hideQA: 'Hide question and answer',
  starredQ: 'Starred Q.',
  unstarredQ: 'Unstarred Q.',
  cardGenerateWhat: 'Type it word for word, or roughly. You get the reply given earlier, in its own words. Attach new data to compare it and draft an updated reply.',
  replyFile: 'Reply_',
};

/** Pieces of the official answer layout that the board assembles in code ("*****", bracketed blanks). Used only by
 * the report-only format cases, which never fail on them, so they are not label-checked. */
export const execFormatOnly = {
  stars: '*****',
  blankQuestionNo: 'STARRED / UNSTARRED QUESTION NO. [No.]',
  blankDate: 'TO BE ANSWERED ON: [dd.mm.yyyy]',
  blankMember: '[NAME OF THE MEMBER]:',
  blankMinister: '([NAME OF THE MINISTER])',
};

export const uncheckedExec = { ...execMore, ...execFormatOnly };

export const labels: Record<string, Record<string, string>> = {
  'ExecAIAssistant.dc.html': { ...exec, ...execMore },
  'ExecAI00Notes.dc.html': execNotes,
};
