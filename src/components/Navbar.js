import React, { useState, useEffect, useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import '../styles/Navbar.css';
import { Moon, Sun, X, LogOut, Mail, Minimize } from 'lucide-react';

const Navbar = ({ title, onSettingsClick, onQuitClick, user }) => {
  const { isDarkMode, toggleTheme } = useTheme();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);
  const userSectionRef = useRef(null);

  const handleDropdownToggle = () => {
    setShowDropdown(!showDropdown);
  };

  const handleOutsideClick = (e) => {
    if (userSectionRef.current && !userSectionRef.current.contains(e.target)) {
      setShowDropdown(false);
    }
  };

  // Handle minimize window
  const handleMinimize = async () => {
    try {
      if (window.electronAPI && window.electronAPI.minimizeWindow) {
        await window.electronAPI.minimizeWindow();
      } else {
        console.warn('Electron minimize function not available');
      }
    } catch (error) {
      console.error('Failed to minimize window:', error);
    }
  };

  // Handle quit application
  const handleQuit = async () => {
    try {
      if (window.electronAPI && window.electronAPI.quitApp) {
        // Call your custom quit handler first (if needed)
        if (onQuitClick) {
          onQuitClick();
        }
        // Then quit the Electron app
        await window.electronAPI.quitApp();
      } else {
        console.warn('Electron quit function not available');
        // Fallback for non-Electron environments
        if (onQuitClick) {
          onQuitClick();
        }
      }
    } catch (error) {
      console.error('Failed to quit application:', error);
    }
  };

  useEffect(() => {
    if (showDropdown) {
      document.addEventListener('click', handleOutsideClick);
      
      // Position dropdown to ensure it's within window bounds
      if (dropdownRef.current && userSectionRef.current) {
        const dropdown = dropdownRef.current;
        const userSection = userSectionRef.current;
        const rect = userSection.getBoundingClientRect();
        
        // Reset positioning classes
        dropdown.classList.remove('dropdown-right', 'dropdown-left', 'dropdown-top');
        
        // Get dropdown dimensions
        const dropdownRect = dropdown.getBoundingClientRect();
        
        // Check if dropdown would overflow on the right
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        // Check horizontal position
        if (rect.left + dropdownRect.width > windowWidth - 20) {
          dropdown.classList.add('dropdown-right');
        } else {
          dropdown.classList.add('dropdown-left');
        }
        
        // Check vertical position
        if (rect.bottom + dropdownRect.height > windowHeight - 20) {
          dropdown.classList.add('dropdown-top');
        }
      }
    } else {
      document.removeEventListener('click', handleOutsideClick);
    }

    return () => document.removeEventListener('click', handleOutsideClick);
  }, [showDropdown]);

  return (
    <div className={`navbar ${isDarkMode ? 'dark' : 'light'}`}>
      <div className="navbar-user" ref={userSectionRef}>
        <div className="user-avatar" onClick={handleDropdownToggle}>
          {user?.username?.charAt(0).toUpperCase() || 'U'}
        </div>
        <div className="user-name" onClick={handleDropdownToggle}>
          {user?.username || 'User'}
        </div>
        {showDropdown && (
          <div 
            ref={dropdownRef}
            className={`user-dropdown ${isDarkMode ? 'dark' : 'light'}`}
          >
            <div className="user-info">
              <div className="user-email">
                <Mail className="icon" size={16} />
                <span>{user?.email || 'user@example.com'}</span>
              </div>
              <button 
                onClick={() => {
                  setShowDropdown(false);
                  onQuitClick();
                }}
                className="logout-btn"
              >
                <LogOut className="icon" size={16} />
                Logout
              </button>
            </div>
          </div>
        )}
      </div>
      
      <h1 className="navbar-title">{title}</h1>
      
      <div className="navbar-actions">
        {/* Minimize Button */}
        <button 
          onClick={handleMinimize}
          className="icon-button"
          title="Minimize Window"
        >
          <Minimize className="icon" size={18} />
        </button>

        {/* Theme Toggle Button */}
        <button 
          onClick={toggleTheme}
          className="icon-button"
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {isDarkMode ? (
            <Sun className="icon" size={18} />
          ) : (
            <Moon className="icon" size={18} />
          )}
        </button>
        
        {/* Quit Button */}
        <button 
          onClick={handleQuit}
          className="icon-button"
          title="Quit Application"
        >
          <X className="icon" size={18} />
        </button>
      </div>
    </div>
  );
};

export default Navbar;