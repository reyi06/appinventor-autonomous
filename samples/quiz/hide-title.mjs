import { relay } from './harness.mjs';

const r = await relay('designer.setProperty', { component: 'Screen1', property: 'TitleVisible', value: 'False' });
console.log('TitleVisible ->', JSON.stringify(r));

const state = await relay('state');
console.log('screen:', state.screen, '| project:', state.projectName);
