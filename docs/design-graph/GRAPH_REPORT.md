# Graph Report - corpus  (2026-11-20)

## Corpus Check
- 18 files · ~83,061 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 372 nodes · 811 edges · 20 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 49 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Executive Dashboard Cases
- FINAL Dashboard Widgets
- My Division Dashboard Cases
- Questions Activity and Final Review
- Executive Assistant Welcome and Shell
- Parliament User Dashboard Cases
- Generate Reply Answers
- Executive Assistant Controls
- Dashboard Themes and Question Basics
- Draft All and Collaboration
- Button System
- Executive Assistant Design Notes
- Draft With AI Side Panel
- Final Review Sources
- Search Documents Answers
- Assistant Working and Stop
- Assistant Not Found
- Final Review Download and Approval
- Clear Chat
- Generate With a Document

## God Nodes (most connected - your core abstractions)
1. `FINAL - My Division Dashboard` - 84 edges
2. `FINAL - Session Command Centre (JS, Director) - Executive Dashboard` - 83 edges
3. `FINAL - PARLIAMENT USER · UX4G accessibility bar` - 77 edges
4. `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)` - 70 edges
5. `DS-EXAI — Executive AI Assistant (design)` - 54 edges
6. `AI Assistant · Welcome (choose Generate reply or Search documents)` - 45 edges
7. `DS-QDET — Question detail and final review (design)` - 43 edges
8. `DS-EXEC — Executive Dashboard (design)` - 41 edges
9. `DS-DIVD — My Division Dashboard (design)` - 40 edges
10. `DS-PARL — Parliament user dashboard (design)` - 33 edges

## Surprising Connections (you probably didn't know these)
- `DS-COLB-01 Input Collaboration Request dialog for one part` --references--> `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)`  [EXTRACTED]
  test-cases/design-test-cases.md → screens/QDetailFinalReview.md
- `DS-COLB-02 Search and select recipients` --references--> `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)`  [EXTRACTED]
  test-cases/design-test-cases.md → screens/QDetailFinalReview.md
- `DS-COLB-03 Request validation blocks sending` --references--> `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)`  [EXTRACTED]
  test-cases/design-test-cases.md → screens/QDetailFinalReview.md
- `DS-COLB-04 Add a government official by email` --references--> `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)`  [EXTRACTED]
  test-cases/design-test-cases.md → screens/QDetailFinalReview.md
- `DS-COLB-05 Cancel or close a request without sending` --references--> `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)`  [EXTRACTED]
  test-cases/design-test-cases.md → screens/QDetailFinalReview.md

## Hyperedges (group relationships)
- **AI Assistant mode choice flow (Generate reply vs Search documents)** — screens_execaiassistant_welcome_mode_choice, screens_execaiassistant_generate_reply, screens_execaiassistant_search_documents, screens_execaiassistant_generate_with_document, screens_execaiassistant_not_found_fallback, screens_execai00notes_mode_choice_guidance [INFERRED 0.85]
- **AI reply pipeline: draft per part → AI Assistant → versions → consolidated answer → download → approval** — screens_qdetailbaseyourdesign_draft_with_ai, screens_qdetailfinalreview_ai_assistant_panel, screens_qdetailfinalreview_draft_sources, screens_qdetailfinalreview_ai_draft_versions, screens_qdetaildraftall_consolidated_answer, screens_qdetailfinalreview_download_word_pdf, screens_qdetailfinalreview_submitted_for_approval, screens_qdetailbaseyourdesign_efile_submission [INFERRED 0.85]
- **Widgets shared by the three FINAL dashboards** — screens_figmatestingcal2_5g42_parliament_session_calendar, screens_figmatestingcal2_5g42_todays_action_plan, screens_figmatestingcal2_5g42_ai_daily_briefing, screens_figmatestingcal2_5g42_top_delayed_questions, screens_figmatestingcal2_5g42_reminders_and_notifications, screens_figmatestingcal2_5g42_export_data_csv, screens_figmatestingcal2_5g42_colour_themes, screens_figmatestingcal2_5g42_ux4gbar_ux4g_accessibility_bar [INFERRED 0.95]

## Communities (20 total, 0 thin omitted)

### Community 0 - "Executive Dashboard Cases"
Cohesion: 0.05
Nodes (72): FINAL - Session Command Centre (JS, Director) - Executive Dashboard, Accessible trend chart (received / submitted / pending, chart-table toggle, arrow keys), DS-EXEC — Executive Dashboard (design), DS-EXEC-01 Page header, persona and search label, DS-EXEC-02 Sidebar items, and Dashboard resets panels, DS-EXEC-03 AI Assistant menu item, DS-EXEC-04 Filter bar layout and defaults, DS-EXEC-05 Dashboard scope options (+64 more)

### Community 1 - "FINAL Dashboard Widgets"
Cohesion: 0.07
Nodes (47): AI Daily Briefing, AI Routing Quality (top suggestion accepted / alternative picked / manually overridden), Division-wise Breakup, Division Work Load (share of admitted questions), Export Data as CSV, Dashboard KPI cards (Uploaded, Admitted, Replies received, Transfer requests, Delayed), Ministry of Commerce & Industry · Commerce Parliamentary Support System, Parliament Session Calendar (sitting-date filter) (+39 more)

### Community 2 - "My Division Dashboard Cases"
Cohesion: 0.10
Nodes (41): FINAL - My Division Dashboard, DS-DIVD — My Division Dashboard (design), DS-DIVD-01 Page header and persona, DS-DIVD-02 Sidebar items, DS-DIVD-03 Admitted Questions count matches the KPI, DS-DIVD-04 Menu items filter Questions Activity, DS-DIVD-05 Transfer Requests menu item, DS-DIVD-06 Dashboard menu item clears filters (+33 more)

### Community 3 - "Questions Activity and Final Review"
Cohesion: 0.12
Nodes (32): Questions Activity table (sort by received/due date, stage filters), Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF), DS-QDET — Question detail and final review (design), DS-QDET-01 Open Question Detail from Questions Activity, DS-QDET-03 Header, status banner and overview of a new admitted question, DS-QDET-04 Priority tag and due-date note follow the deadline (unstarred), DS-QDET-07 View Uploaded Question dialog, DS-QDET-08 Questions in this Document: first view (+24 more)

### Community 4 - "Executive Assistant Welcome and Shell"
Cohesion: 0.09
Nodes (25): AI Assistant · Welcome (choose Generate reply or Search documents), Session Command Centre / Executive Dashboard, Parliament Session Calendar, Question status lifecycle (Draft to Completed), Notifications and reminders ('Reminder sent' toasts), Skip to Main Content link, Top utilities (text size, accessibility, language), DS-EXAI-01 Open the AI Assistant from the Executive Dashboard (+17 more)

### Community 5 - "Parliament User Dashboard Cases"
Cohesion: 0.12
Nodes (17): DS-COLB — Input collaboration and transfer (design), DS-COLB-01 Input Collaboration Request dialog for one part, DS-COLB-02 Search and select recipients, DS-COLB-03 Request validation blocks sending, DS-COLB-04 Add a government official by email, DS-COLB-05 Cancel or close a request without sending, DS-COLB-06 Send a request, DS-COLB-07 Ask for inputs on an already saved part (+9 more)

### Community 6 - "Generate Reply Answers"
Cohesion: 0.23
Nodes (16): AI Assistant · Generate reply · the reply given in Parliament, DS-EXAI — Executive AI Assistant (design), DS-EXAI-17 Generate reply: the reply given in Parliament, in the official format (format under consideration — report only), DS-EXAI-18 Reply that lays a statement on the Table (format under consideration — report only), DS-EXAI-27 Copy answer, DS-EXAI-28 Download as Word, DS-EXAI-29 Word file looks like the House document (format under consideration — report only), DS-EXAI-31 Recents: titles, dates and the open chat (+8 more)

### Community 7 - "Executive Assistant Controls"
Cohesion: 0.18
Nodes (15): Draft with AI button, Icon buttons (Send, Copy, Delete chat), Answer kind label (Reply given in Parliament / New draft / From our documents), Try in the prototype (test scenarios), Executive AI Assistant, Answer actions (Copy answer, Download as Word), Clear / Delete chat confirmation dialog, Commerce Parliamentary Support System (Ministry of Commerce & Industry) (+7 more)

### Community 8 - "Dashboard Themes and Question Basics"
Cohesion: 0.15
Nodes (14): Eight colour themes (Indigo Ink, Institutional Navy, Clinical Teal, Emerald Ledger, Graphite Slate, Royal Blue, Royal Violet, Walnut Brown), Transfer Requests (Accept / Reject), Reminders and notifications (Send SMS/Email, Remind all overdue, auto-reminder), UX4G accessibility bar (text size, accessibility options, English/Hindi language), Question detail · BASE · Your design (Department - Detailed question), Movement Timeline (current stage, time at stage), Question lifecycle stages (Provisional, Admitted, Forwarded, Pending, Submitted/Awaiting Parliament, Urgent), View Uploaded Question (question PDF beside the page) (+6 more)

### Community 9 - "Draft All and Collaboration"
Cohesion: 0.18
Nodes (15): Draft all with AI, E-file number submission, Input Collaboration Request (ask another division for inputs), Questions in this Document (sub-question parts A, B, C, D), Question detail · Draft all with AI → review each part → consolidated answer, Consolidated answer (all saved parts combined), Draft-all flow (6 states: not started → drafting all → review each part → all saved → consolidated answer → e-file submitted), Cyber Security Division (+7 more)

### Community 10 - "Button System"
Cohesion: 0.23
Nodes (13): Button system (UX4G 3.0 buttons in Indigo Ink), Indigo Ink theme, UX4G 3.0 button variants and states, Theme palettes (Indigo Ink, Institutional Navy, Clinical Teal, Emerald Ledger, Graphite Slate, Royal Blue, Royal Violet, Walnut Brown), Design test-case catalogue (DS-*), DS-BTN — Button system on the FINAL screens (design), DS-BTN-01 Icon-only buttons have a name and a matching tooltip, DS-BTN-02 Keyboard focus shows a ring on every button (+5 more)

### Community 11 - "Executive Assistant Design Notes"
Cohesion: 0.27
Nodes (7): AI Assistant · design notes, For developers (layout, features, accessibility, tokens, icons), The Figma, piece by piece (In the Figma vs Now), AI Assistant header gradient (primary to accent, white text), ux4g-web-components 3.0.3 (UX4G 3.0 tokens and Material Icons Outlined font), Words we changed (Before / Now copy table), What do you want to do? (mode choice)

### Community 12 - "Draft With AI Side Panel"
Cohesion: 0.25
Nodes (9): Draft with AI (per part), Question detail · Draft with AI (AI Assistant opens beside the page, part A), AI Assistant opens beside the page (Popup 1 drafting, Popup 2 draft ready), AI Assistant side panel (conversation about a part), AI draft versions (compare, Use this version, your edit kept as new version), Quick requests (Make it shorter, more formal, Write in Hindi, Use the received input, Try another version), DS-QDET-11 Draft with AI on one part opens the AI Assistant beside the page, DS-QDET-12 AI Assistant panel layout, info tooltip and closing (+1 more)

### Community 13 - "Final Review Sources"
Cohesion: 0.42
Nodes (9): CERT-In audit guidelines, CERT-In incident reports 2023 to 2025, Draft sources with match strength (Strong match / Related), GIGW 3.0 (Guidelines for Indian Government Websites), Ministry of Electronics and Information Technology, NIC hosting security policy 2025, NIC Security Operations Centre note, Sample question: Security of government websites hosted by NIC (RS Unstarred, D. No. 16448) (+1 more)

### Community 14 - "Search Documents Answers"
Cohesion: 0.25
Nodes (8): AI Assistant · Search documents · answer from our documents, DS-EXAI-20 Search documents: answer from our documents (format under consideration — report only), DS-EXAI-21 Sort the search results (format under consideration — report only), DS-EXAI-22 Show and hide the question and answer of a result (format under consideration — report only), DS-EXAI-23 View document opens the source PDF at the page, DS-EXAI-32 Open a recent chat, DS-EXAI-45 Rough wording and grounding in our documents (moved to DS-EXAI-47, DS-EXAI-50, DS-EXAI-51), DS-EXAI-50 Search documents returns the right documents

### Community 15 - "Assistant Working and Stop"
Cohesion: 0.29
Nodes (7): AI Assistant · Working (Stop), Working state with Stop, DS-EXAI-13 Ask in Generate reply: working state and Recents, DS-EXAI-14 Working message when a document is attached, DS-EXAI-15 Working message in Search documents, DS-EXAI-16 Stop while it works, DS-EXAI-33 Leaving a chat while it works

### Community 16 - "Assistant Not Found"
Cohesion: 0.33
Nodes (6): AI Assistant · Not found · ask the other way, DS-EXAI-24 Not found in Generate reply: ask the other way, DS-EXAI-25 Not found in Search documents: generate a reply instead, DS-EXAI-26 Asking the other way does not carry the attachment, DS-EXAI-48 Not in the knowledge base: no invented figures (Part 2), DS-EXAI-51 Search documents does not answer beyond our documents

### Community 17 - "Final Review Download and Approval"
Cohesion: 0.33
Nodes (6): Download final reply as Word or PDF (Parliament reply format), Final review flow (8 states: not started → drafts ready → reviewing → refining → part C with inputs → all saved → final review → final reply downloaded), Submitted for approval (approval continues outside the system), Question detail · Final review flow · STARRED question, DS-QDET-05 Starred question: always High priority, filled Starred tag, DS-QDET-06 Visual and motion checks

### Community 18 - "Clear Chat"
Cohesion: 0.67
Nodes (3): AI Assistant · Clear chat (asks first), DS-EXAI-37 Clear chat asks first: text and focus, DS-EXAI-38 Clear chat removes the chat

### Community 19 - "Generate With a Document"
Cohesion: 0.67
Nodes (3): AI Assistant · Generate reply with a document · new draft, DS-EXAI-19 Generate reply with a document: new draft (format under consideration — report only), DS-EXAI-52 Generate reply with a document uses the attached new figures

## Ambiguous Edges - Review These
- `Ministry of Electronics and Information Technology` → `FINAL - My Division Dashboard`  [AMBIGUOUS]
  screens/FigmaTestingCal2-5g42-i92s.md · relation: conceptually_related_to

## Knowledge Gaps
- **9 isolated node(s):** `Accessible trend chart (received / submitted / pending, chart-table toggle, arrow keys)`, `Skip to Main Content link`, `Top utilities (text size, accessibility, language)`, `Platform Analytics`, `Settings menu (Users & roles, Divisions, Designations, Sessions, Document Ingestion, Knowledge Garden, Response Deadlines)` (+4 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 9 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Design test-case catalogue (DS-*)` connect `Button System` to `Executive Dashboard Cases`, `FINAL Dashboard Widgets`, `My Division Dashboard Cases`, `Questions Activity and Final Review`, `Parliament User Dashboard Cases`, `Generate Reply Answers`?**
  _High betweenness centrality (0.382) - this node is a cross-community bridge._
- **What connects `Accessible trend chart (received / submitted / pending, chart-table toggle, arrow keys)`, `Skip to Main Content link`, `Top utilities (text size, accessibility, language)` to the rest of the system?**
  _9 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Executive Dashboard Cases` be split into smaller, more focused modules?**
  _Cohesion score 0.05359937402190924 - nodes in this community are weakly interconnected._
- **Why does `DS-EXAI — Executive AI Assistant (design)` connect `Generate Reply Answers` to `Executive Assistant Welcome and Shell`, `Button System`, `Search Documents Answers`, `Assistant Working and Stop`, `Assistant Not Found`, `Clear Chat`, `Generate With a Document`?**
  _High betweenness centrality (0.309) - this node is a cross-community bridge._
- **Should `FINAL Dashboard Widgets` be split into smaller, more focused modules?**
  _Cohesion score 0.07215541165587419 - nodes in this community are weakly interconnected._
- **Why does `Question detail · Final review flow (draft with AI → save each part → final review → download Word/PDF)` connect `Questions Activity and Final Review` to `My Division Dashboard Cases`, `Parliament User Dashboard Cases`, `Dashboard Themes and Question Basics`, `Draft All and Collaboration`, `Draft With AI Side Panel`, `Final Review Sources`, `Final Review Download and Approval`?**
  _High betweenness centrality (0.237) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Ministry of Electronics and Information Technology` and `FINAL - My Division Dashboard`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._