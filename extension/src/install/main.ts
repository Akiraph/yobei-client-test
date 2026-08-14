import { initializeLocale, locale, nextLocaleDisplayName, t, toggleLocale } from '../lib/i18n';
import './install.css';

const root = document.getElementById('root');

function createStep(number: string, title: string, body: string): HTMLElement {
  const step = document.createElement('li');
  step.className = 'step';
  step.innerHTML = `<span class="step-number">${number}</span><div><h2>${title}</h2><p>${body}</p></div>`;
  return step;
}

function render(): void {
  if (!root) return;
  document.documentElement.lang = locale();
  document.title = t('install.pageTitle');
  root.replaceChildren();

  const page = document.createElement('main');
  page.className = 'install-page';

  const header = document.createElement('header');
  header.className = 'install-header';
  const brand = document.createElement('div');
  brand.className = 'install-brand';
  const logo = document.createElement('img');
  logo.className = 'install-logo';
  logo.src = chrome.runtime.getURL('icons/128.png');
  logo.alt = 'Yobei';
  brand.append(logo);

  const heading = document.createElement('div');
  heading.innerHTML = `<span class="eyebrow">Yobei</span><h1>${t('install.heading')}</h1>`;
  brand.append(heading);
  header.append(brand);

  const languageButton = document.createElement('button');
  languageButton.className = 'language-button';
  languageButton.type = 'button';
  languageButton.textContent = nextLocaleDisplayName();
  languageButton.setAttribute('aria-label', t('app.language'));
  languageButton.addEventListener('click', () => {
    toggleLocale();
    render();
  });
  header.append(languageButton);

  const description = document.createElement('p');
  description.className = 'description';
  description.textContent = t('install.description');

  const steps = document.createElement('ol');
  steps.className = 'steps';
  steps.append(
    createStep('1', t('install.stepOneTitle'), t('install.stepOneBody')),
    createStep('2', t('install.stepTwoTitle'), t('install.stepTwoBody')),
    createStep('3', t('install.stepThreeTitle'), t('install.stepThreeBody')),
  );

  const close = document.createElement('button');
  close.className = 'close-button';
  close.type = 'button';
  close.textContent = t('install.close');
  close.addEventListener('click', () => {
    chrome.tabs.getCurrent((tab) => {
      if (tab?.id !== undefined) void chrome.tabs.remove(tab.id);
      else window.close();
    });
  });

  page.append(header, description, steps, close);
  root.append(page);
}

void initializeLocale().then(render);
