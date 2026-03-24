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

  function handleOpenAppParam() {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action !== 'open') return;

    const mode = params.get('mode') || '';
    const section = document.getElementById('open-app-section');
    if (!section) return;

    const schemeUrl = mode ? `pneuma://open/${mode}` : 'pneuma://open';
    const label = mode ? `Open ${mode} in Pneuma` : 'Open in Pneuma';

    section.removeAttribute('hidden');
    section.innerHTML = `
      <a href="${schemeUrl}" class="open-app-btn">${label}</a>
      <p class="open-app-hint">If Pneuma is installed, it will open automatically.</p>
    `;
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderDownloadSection();
    handleOpenAppParam();
  });
})();
