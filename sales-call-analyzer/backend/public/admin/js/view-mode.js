/**
 * View Mode Module
 *
 * Provides frontend-only "User View" toggle for admins to preview the app
 * as a regular user without changing backend permissions.
 *
 * Usage:
 * - Include this script in admin pages
 * - Call initViewMode() after initUserMenu()
 * - Use getEffectiveRole(actualRole) for permission checks
 */

(function(window) {
  'use strict';

  const STORAGE_KEY = 'viewMode';
  const VIEW_ADMIN = 'admin';
  const VIEW_USER = 'user';

  // Get current view mode from localStorage
  function getViewMode() {
    return localStorage.getItem(STORAGE_KEY) || VIEW_ADMIN;
  }

  // Set view mode in localStorage
  function setViewMode(mode) {
    localStorage.setItem(STORAGE_KEY, mode);
  }

  // Check if currently in user view mode
  function isUserView() {
    return getViewMode() === VIEW_USER;
  }

  // Get effective role (for permission checks)
  // If in user view mode, always returns 'user' regardless of actual role
  function getEffectiveRole(actualRole) {
    if (isUserView() && actualRole === 'admin') {
      return 'user';
    }
    return actualRole;
  }

  // Toggle between admin and user view
  function toggleViewMode() {
    const currentMode = getViewMode();
    const newMode = currentMode === VIEW_ADMIN ? VIEW_USER : VIEW_ADMIN;
    setViewMode(newMode);
    // Reload page to apply new mode
    window.location.reload();
  }

  // Update UI elements for current view mode
  // Call this after initUserMenu() has completed
  function initViewMode(actualRole) {
    // Only show view mode controls to actual admins
    if (actualRole !== 'admin') {
      return;
    }

    const inUserView = isUserView();

    // Update header indicator
    const indicator = document.getElementById('viewModeIndicator');
    if (indicator) {
      indicator.style.display = inUserView ? 'flex' : 'none';
    }

    // Update dropdown toggle item
    const toggleItem = document.getElementById('viewModeToggle');
    if (toggleItem) {
      const label = toggleItem.querySelector('.view-mode-label');
      if (label) {
        label.textContent = inUserView ? 'Back to admin' : 'User view';
      }
      // Update tooltip
      toggleItem.setAttribute('data-tooltip',
        inUserView ? 'Return to admin view with full permissions' : 'Preview app as a regular user');
    }

    // If in user view, hide admin-only elements
    if (inUserView) {
      document.querySelectorAll('.ds-admin-only').forEach(el => {
        el.style.display = 'none';
      });

      // Update role display to show "User" instead of "Admin"
      const roleDisplay = document.getElementById('userDisplayRole') ||
                          document.getElementById('user-display-role');
      if (roleDisplay) {
        roleDisplay.textContent = 'User (View Mode)';
      }

      const roleBadge = document.getElementById('userRoleBadge') ||
                        document.getElementById('user-role-badge');
      if (roleBadge) {
        roleBadge.textContent = 'User';
        roleBadge.className = 'ds-dropdown-role user';
      }
    }

    // Show the view mode section in dropdown (only for actual admins)
    const viewModeSection = document.getElementById('viewModeSection');
    if (viewModeSection) {
      viewModeSection.style.display = '';
    }

    // Also show the view mode toggle container
    const viewModeToggleContainer = document.getElementById('viewModeToggleContainer');
    if (viewModeToggleContainer) {
      viewModeToggleContainer.style.display = '';
    }
  }

  // Check if user should be redirected from admin-only pages
  // Returns true if access is allowed, false if redirect needed
  function checkAdminPageAccess(actualRole) {
    const effectiveRole = getEffectiveRole(actualRole);
    if (effectiveRole !== 'admin') {
      // In user view mode on admin-only page - redirect to home
      window.location.href = '/admin/';
      return false;
    }
    return true;
  }

  // Expose functions globally
  window.ViewMode = {
    getViewMode: getViewMode,
    setViewMode: setViewMode,
    isUserView: isUserView,
    getEffectiveRole: getEffectiveRole,
    toggleViewMode: toggleViewMode,
    initViewMode: initViewMode,
    checkAdminPageAccess: checkAdminPageAccess
  };

})(window);
