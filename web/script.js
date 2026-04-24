(function () {
  'use strict';

  const GITHUB_RELEASES = 'https://github.com/pandazki/pneuma-skills/releases/latest';

  function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    const platform = navigator.platform?.toLowerCase() || '';

    if (ua.includes('mac') || platform.includes('mac')) {
      const arch = navigator.userAgentData?.architecture === 'arm' ? 'arm64' : 'x64';
      return { os: 'mac', arch };
    }
    if (ua.includes('win') || platform.includes('win')) {
      return { os: 'win', arch: 'x64' };
    }
    if (ua.includes('linux')) {
      return { os: 'linux', arch: 'x64' };
    }
    return { os: 'unknown', arch: 'x64' };
  }

  function renderDownloadSection() {
    const section = document.getElementById('download-section');
    if (!section) return;

    const { os } = detectOS();

    const labels = {
      mac: 'Download for macOS',
      win: 'Download for Windows',
      linux: 'Download for Linux',
      unknown: 'View All Downloads',
    };

    const label = labels[os] || labels.unknown;

    section.innerHTML = `
      <a href="${GITHUB_RELEASES}" class="download-btn" target="_blank" rel="noopener">
        ${label}
      </a>
      ${os !== 'unknown' ? `<a href="${GITHUB_RELEASES}" class="all-platforms" target="_blank" rel="noopener">All platforms</a>` : ''}
    `;
  }

  function handleActionParam() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    const section = document.getElementById('open-app-section');
    if (!section) return;

    let schemeUrl = '';
    let label = '';
    let hint = 'If Pneuma is installed, it will open automatically.';

    switch (action) {
      case 'open': {
        const mode = params.get('mode') || '';
        schemeUrl = mode ? `pneuma://open/${mode}` : 'pneuma://open';
        label = mode ? `Open ${mode} in Pneuma` : 'Open in Pneuma';
        break;
      }
      case 'import': {
        const url = params.get('url') || '';
        if (!url) return;
        schemeUrl = `pneuma://import/${encodeURIComponent(url)}`;
        label = 'Import in Pneuma';
        hint = 'Opens Pneuma and imports this shared workspace.';
        break;
      }
      case 'mode': {
        const url = params.get('url') || '';
        if (!url) return;
        schemeUrl = `pneuma://mode/${encodeURIComponent(url)}`;
        label = 'Install mode in Pneuma';
        hint = 'Opens Pneuma and installs this mode from the URL.';
        break;
      }
      default:
        return;
    }

    section.removeAttribute('hidden');
    section.innerHTML = `
      <a href="${schemeUrl}" class="open-app-btn">${label}</a>
      <p class="open-app-hint">${hint}</p>
    `;
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderDownloadSection();
    handleActionParam();
  });
})();
