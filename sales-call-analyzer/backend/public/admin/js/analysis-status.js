/**
 * Analysis Status Banner
 * Shows a banner when bulk analysis is in progress across all pages
 */

(function() {
  'use strict';

  const API_BASE = '/api';
  let statusPolling = null;
  let statusBanner = null;

  // Create and inject the status banner
  function createStatusBanner() {
    statusBanner = document.createElement('div');
    statusBanner.id = 'global-analysis-status';
    statusBanner.className = 'analysis-status-banner';
    statusBanner.innerHTML = `
      <div class="analysis-status-content">
        <span class="analysis-status-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v6l4 2"></path>
          </svg>
        </span>
        <span class="analysis-status-text">Analysis in progress...</span>
        <span class="analysis-status-progress">
          <span id="analysis-progress-count">0</span> / <span id="analysis-progress-total">0</span>
        </span>
        <a href="/admin/index.html" class="analysis-status-link">View Progress</a>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      .analysis-status-banner {
        display: none;
        background: linear-gradient(90deg, #0a2540 0%, #1a4a7a 100%);
        color: white;
        padding: 10px 20px;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        animation: slideDown 0.3s ease;
      }

      .analysis-status-banner.visible {
        display: block;
      }

      @keyframes slideDown {
        from {
          transform: translateY(-100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }

      .analysis-status-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        max-width: 1200px;
        margin: 0 auto;
        font-size: 14px;
      }

      .analysis-status-icon {
        display: flex;
        align-items: center;
        animation: pulse 1.5s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .analysis-status-text {
        font-weight: 500;
      }

      .analysis-status-progress {
        background: rgba(255, 255, 255, 0.2);
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 12px;
      }

      .analysis-status-link {
        color: #60a5fa;
        text-decoration: none;
        font-weight: 500;
        margin-left: 8px;
      }

      .analysis-status-link:hover {
        text-decoration: underline;
      }

      /* Push page content down when banner is visible */
      body.has-analysis-banner {
        padding-top: 44px;
      }
    `;

    document.head.appendChild(style);
    document.body.insertBefore(statusBanner, document.body.firstChild);
  }

  // Check analysis status
  async function checkAnalysisStatus() {
    try {
      const response = await fetch(`${API_BASE}/bulk/analyze/status`);
      const data = await response.json();

      if (data.success) {
        if (data.inProgress && data.progress) {
          showBanner(data.progress);
        } else {
          hideBanner();
        }
      }
    } catch (error) {
      // Silently fail - don't disrupt user experience
      console.debug('Analysis status check failed:', error);
    }
  }

  // Show the banner
  function showBanner(progress) {
    if (!statusBanner) createStatusBanner();

    const countEl = document.getElementById('analysis-progress-count');
    const totalEl = document.getElementById('analysis-progress-total');

    if (countEl) countEl.textContent = progress.processed || 0;
    if (totalEl) totalEl.textContent = progress.total || 0;

    statusBanner.classList.add('visible');
    document.body.classList.add('has-analysis-banner');
  }

  // Hide the banner
  function hideBanner() {
    if (statusBanner) {
      statusBanner.classList.remove('visible');
      document.body.classList.remove('has-analysis-banner');
    }
  }

  // Start polling for status
  function startPolling() {
    // Check immediately
    checkAnalysisStatus();

    // Then poll every 3 seconds
    statusPolling = setInterval(checkAnalysisStatus, 3000);
  }

  // Stop polling
  function stopPolling() {
    if (statusPolling) {
      clearInterval(statusPolling);
      statusPolling = null;
    }
  }

  // Initialize on page load
  function init() {
    // Don't run on the Calls page (index.html) - it has its own detailed progress UI
    if (window.location.pathname.includes('/index.html') || window.location.pathname.endsWith('/admin/')) {
      return;
    }

    createStatusBanner();
    startPolling();

    // Stop polling when page is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', stopPolling);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Export for manual control
  window.AnalysisStatus = {
    check: checkAnalysisStatus,
    show: showBanner,
    hide: hideBanner,
    start: startPolling,
    stop: stopPolling
  };
})();
