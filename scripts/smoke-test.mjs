import { parseJsonTrackerResponse } from '../dist/parser.js';
import { DEFAULT_TEMPLATE_HTML, renderTrackerTemplate, stripDangerousHtml } from '../dist/shared.js';

const parsed = parseJsonTrackerResponse('```json\n{"time":"noon",}\n```');
if (parsed.data.time !== 'noon') {
  throw new Error('parser failed');
}

const html = renderTrackerTemplate(DEFAULT_TEMPLATE_HTML, {
  time: 'noon',
  location: 'Cafe',
  mood: 'calm',
  situation: 'Talking',
  charactersPresent: ['A'],
  characters: [
    {
      name: 'A',
      appearance: 'neat',
      outfit: 'coat',
      posture: 'standing',
      notableState: 'alert',
    },
  ],
  openThreads: ['plan'],
});

if (!html.includes('Cafe') || html.includes('<script')) {
  throw new Error('template failed');
}

const ztrackerTemplate = `
  {{#if data.show.summary}}
    <section class="summary">{{data.summary}}</section>
  {{/if}}
  {{#unless data.show.secret}}
    <section class="public">visible</section>
  {{/unless}}
  <ul>
  {{#each data.cast}}
    <li>{{this.name}}
      <ol>
      {{#each this.inventory}}
        <li>{{this.label}}: {{this.count}}</li>
      {{/each}}
      </ol>
    </li>
  {{/each}}
  </ul>
  <p>{{join data.tags ', '}}</p>
  <script>alert("bad")</script>
  <a href="javascript:alert(1)" onclick="alert(1)">bad link</a>
  <iframe src="https://example.test"></iframe>
`;

const ztrackerHtml = renderTrackerTemplate(ztrackerTemplate, {
  show: { summary: true, secret: false },
  summary: 'Nested tracker works',
  cast: [
    {
      name: 'Silvia',
      inventory: [
        { label: 'Key', count: 1 },
        { label: 'Map', count: 2 },
      ],
    },
  ],
  tags: ['scene', 'safe'],
}, { templateEngine: 'handlebars' });

if (
  !ztrackerHtml.includes('Nested tracker works')
  || !ztrackerHtml.includes('visible')
  || !ztrackerHtml.includes('Silvia')
  || !ztrackerHtml.includes('Key: 1')
  || !ztrackerHtml.includes('scene, safe')
  || /{{[#/]?/.test(ztrackerHtml)
  || ztrackerHtml.includes('<script')
  || ztrackerHtml.includes('<iframe')
  || ztrackerHtml.includes('javascript:')
  || ztrackerHtml.includes('onclick=')
) {
  throw new Error('handlebars zTracker template failed');
}

const falseSectionHtml = renderTrackerTemplate('{{#if data.show.secret}}hidden{{/if}}', {
  show: { secret: false },
}, { templateEngine: 'handlebars' });
if (falseSectionHtml.includes('hidden')) {
  throw new Error('handlebars false #if block rendered unexpectedly');
}

if (stripDangerousHtml('<iframe src="x"></iframe><b>ok</b>') !== '<b>ok</b>') {
  throw new Error('iframe sanitizer failed');
}

console.log('smoke ok');
