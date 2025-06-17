import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ThemeProvider } from './contexts/ThemeContext';
import { TaskProvider } from './contexts/TaskContext';
import Navbar from './components/Navbar';
import SettingsPage from './components/SettingsPage';
import { CSSTransition } from 'react-transition-group';
import './App.css';
import './styles/animations.css';
import { Keyboard, MousePointerClick } from 'lucide-react';

// Key code mappings for display
const KEY_CODES = {
  8: 'Backspace', 9: 'Tab', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
  19: 'Pause', 20: 'Caps Lock', 27: 'Escape', 32: 'Space', 33: 'Page Up',
  34: 'Page Down', 35: 'End', 36: 'Home', 37: 'Left Arrow', 38: 'Up Arrow',
  39: 'Right Arrow', 40: 'Down Arrow', 45: 'Insert', 46: 'Delete',
  48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
  65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I',
  74: 'J', 75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R',
  83: 'S', 84: 'T', 85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
  112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
  118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12'
};

function App() {
  const [selections, setSelections] = useState({
    project: '',
    task: '',
    subtask: '',
    action: '',
    subaction: ''
  });

  const [showTracker, setShowTracker] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [baseActualTime, setBaseActualTime] = useState(0);
  const timerRef = useRef(null);
  const [projects, setProjects] = useState({});
  const [projectsList, setProjectsList] = useState([]); // Store projects as an array of objects with id and name
  const [loading, setLoading] = useState(true);

  const [tasks, setTasks] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [tasksLoading, setTasksLoading] = useState(false);
  const [allTasks, setAllTasks] = useState([]);
  const [isTracking, setIsTracking] = useState(false);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const eventsEndRef = useRef(null);
  const [isElectron, setIsElectron] = useState(false);
  const [apiReady, setApiReady] = useState(false);

  const maxEvents = 1000;
  const [screenshotInterval, setScreenshotInterval] = useState(null);
  const [lastScreenshot, setLastScreenshot] = useState(null);

  const [stats, setStats] = useState({
    mouseClicks: 0,
    keyPresses: 0,
    mouseMoves: 0
  });
  const statsRef = useRef(stats);
  // Update the ref when stats change
  const [timerStartTime, setTimerStartTime] = useState(null);
  const [showTimeWarning, setShowTimeWarning] = useState(false);

  // Helper function to get estimated time based on current selections
  const getEstimatedTime = () => {
    try {
      let estimatedTime = 0; // Default to 0 instead of 'N/A'

      // Start from the deepest selection and work backwards
      if (selections.subaction) {
        const selectedSubaction = tasks.find(t => t.name === selections.subaction);
        estimatedTime = selectedSubaction?.estHours || 0;
      } else if (selections.action) {
        const selectedAction = tasks.find(t => t.name === selections.action);
        estimatedTime = selectedAction?.estHours || 0;
      } else if (selections.subtask) {
        const selectedSubtask = tasks.find(t => t.name === selections.subtask);
        estimatedTime = selectedSubtask?.estHours || 0;
      } else if (selections.task) {
        const selectedTask = tasks.find(t => t.name === selections.task);
        estimatedTime = selectedTask?.estHours || 0;
      }

      // Format the time
      const hours = Math.floor(estimatedTime);
      const minutes = Math.round((estimatedTime - hours) * 60);

      if (hours === 0 && minutes === 0) return '0 min';
      if (hours === 0) return `${minutes} min`;
      if (minutes === 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes} min`;

    } catch (error) {
      console.error('Error calculating estimated time:', error);
      return '0 min';
    }
  };

  const getActualTime = () => {
    try {
      let actualTime = 0;
      let storedTime = 0;

      // Get stored time from the selected item
      if (selections.subaction) {
        const selected = tasks.find(t => t.name === selections.subaction);
        storedTime = selected?.actHours || 0;
      } else if (selections.action) {
        const selected = tasks.find(t => t.name === selections.action);
        storedTime = selected?.actHours || 0;
      } else if (selections.subtask) {
        const selected = tasks.find(t => t.name === selections.subtask);
        storedTime = selected?.actHours || 0;
      } else if (selections.task) {
        const selected = tasks.find(t => t.name === selections.task);
        storedTime = selected?.actHours || 0;
      }

      // If timer is running, use elapsedTime, otherwise use stored time
      actualTime = timerRunning ? (elapsedTime / (1000 * 60 * 60)) : storedTime;

      // Always use the same rounding logic
      const totalSeconds = Math.floor(actualTime * 3600);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);

      if (hours === 0 && minutes === 0) return '0 min';
      if (hours === 0) return `${minutes} min`;
      if (minutes === 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes} min`;

    } catch (error) {
      console.error('Error calculating actual time:', error);
      return '0 min';
    }
  };

  const isTimeExceeded = () => {
    try {
      const selectedTask = tasks.find(t => t.name === selections.task);
      const selectedSubtask = selections.subtask ? allTasks.find(t => t.name === selections.subtask) : null;
      const selectedAction = selections.action ? allTasks.find(t => t.name === selections.action) : null;
      const selectedSubaction = selections.subaction ? allTasks.find(t => t.name === selections.subaction) : null;
      const selectedItem = selectedSubaction || selectedAction || selectedSubtask || selectedTask;

      if (!selectedItem) return false;

      const estimatedTime = selectedItem.estHours || 0;
      const actualTime = timerRunning
        ? elapsedTime / (1000 * 60 * 60)  // Use current elapsed time if running
        : selectedItem.actHours || 0;     // Use stored time if not running

      return estimatedTime > 0 && actualTime > estimatedTime;
    } catch (error) {
      console.error('Error checking time limit:', error);
      return false;
    }
  };


  // Time formatting functions
  const formatTime = (milliseconds) => {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatActualTime = (milliseconds) => {
    const totalMinutes = Math.floor(milliseconds / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} min`;
    return `${hours}h ${minutes}m`;
  };
  const startTimer = async () => {
    if (!timerRunning) {
      setShowTracker(true);
      setTimerRunning(true);

      // Get selected item
      const selectedProject = projectsList.find(p => p.name === selections.project);
      const selectedTask = tasks.find(t => t.name === selections.task);
      const selectedSubtask = selections.subtask ? allTasks.find(t => t.name === selections.subtask) : null;
      const selectedAction = selections.action ? allTasks.find(t => t.name === selections.action) : null;
      const selectedSubaction = selections.subaction ? allTasks.find(t => t.name === selections.subaction) : null;
      const selectedItem = selectedSubaction || selectedAction || selectedSubtask || selectedTask;

      // Set base time if not already set
      let currentBaseTime = baseActualTime;
      if (selectedItem?.actHours && currentBaseTime === 0) {
        currentBaseTime = selectedItem.actHours * 60 * 60 * 1000;
        setBaseActualTime(currentBaseTime);
      }

      // Reset elapsed time to the base time
      setElapsedTime(currentBaseTime);

      const startTime = Date.now();
      setTimerStartTime(startTime);

      // Clear any existing interval
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }

      timerRef.current = setInterval(() => {
        const now = Date.now();
        const elapsed = now - startTime;
        setElapsedTime(currentBaseTime + elapsed);
      }, 1000);

      // Set tracking context if we have both project and task
      if (selectedProject && selectedTask) {
        await window.electronAPI.setTrackingContext({
          projectID: selectedProject.id,
          userID: 1, // Set appropriate user ID
          taskID: selectedTask.id,
          subtaskID: selectedSubtask?.id || null,
          actionItemID: selectedAction?.id || null,
          subactionItemID: selectedSubaction?.id || null,
          taskname: selectedTask.name,
          subtaskname: selectedSubtask?.name || null,
          actionname: selectedAction?.name || null,
          subactionname: selectedSubaction?.name || null,
          projectname: selectedProject.name
        });
      }

      // Start tracking if not already tracking
      if (!isTracking) {
        try {
          await handleStartTracking();
        } catch (err) {
          setError(`Failed to start tracking: ${err.message}`);
          stopTimer();
        }
      }
    }
  };

  const stopTimer = async () => {
    clearInterval(timerRef.current);
    setTimerRunning(false);
    try {
      await saveTimeToDatabase();
      
      // Stop tracking with proper offline handling
      try {
        const result = await window.electronAPI.invoke('stop-tracking');
        if (!result.success) {
          console.warn('Tracking stopped locally:', result.message);
        }
        handleStopTracking();
      } catch (error) {
        console.warn('Error stopping tracking, but continuing:', error);
        // Even if there's an error, we still want to update the UI
        handleStopTracking();
      }
      
      setShowTracker(false);
      setEvents([]);
      setStats({ mouseClicks: 0, keyPresses: 0, mouseMoves: 0 });
    } catch (err) {
      console.error('Error stopping timer:', err);
    }
  };

  const pauseTimer = async () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerRunning(false);
    try {
      await saveTimeToDatabase();
      
      // Pause tracking with proper offline handling
      try {
        const result = await window.electronAPI.invoke('stop-tracking');
        if (!result.success) {
          console.warn('Tracking paused locally:', result.message);
        }
        handlePauseTracking();
      } catch (error) {
        console.warn('Error pausing tracking, but continuing:', error);
        // Even if there's an error, we still want to update the UI
        handlePauseTracking();
      }
      
      setEvents([]);
      setStats({ mouseClicks: 0, keyPresses: 0, mouseMoves: 0 });
    } catch (err) {
      console.error('Error pausing timer:', err);
    }
  };

  const resetTimerAndBackToSelection = async () => {
    clearInterval(timerRef.current);
    try {
      await saveTimeToDatabase();
      
      // Stop tracking with proper offline handling
      try {
        const result = await window.electronAPI.invoke('stop-tracking');
        if (!result.success) {
          console.warn('Tracking stopped locally during reset:', result.message);
        }
        handleStopTracking();
      } catch (error) {
        console.warn('Error stopping tracking during reset, but continuing:', error);
        // Even if there's an error, we still want to update the UI
        handleStopTracking();
      }
      
      setTimerRunning(false);
      setShowTracker(false);
      setElapsedTime(0);
      setBaseActualTime(0);
      setTimerStartTime(null);
      setEvents([]);
      setStats({ mouseClicks: 0, keyPresses: 0, mouseMoves: 0 });
    } catch (err) {
      console.error('Error saving time before reset:', err);
    }
  };

  const saveTimeToDatabase = async () => {
    const selectedTask = tasks.find(t => t.name === selections.task);
    const selectedSubtask = selections.subtask ? allTasks.find(t => t.name === selections.subtask) : null;
    const selectedAction = selections.action ? allTasks.find(t => t.name === selections.action) : null;
    const selectedSubaction = selections.subaction ? allTasks.find(t => t.name === selections.subaction) : null;
    const selectedItem = selectedSubaction || selectedAction || selectedSubtask || selectedTask;

    if (!selectedItem) return;

    // Calculate total time in hours
    const totalHoursSpent = elapsedTime / (60 * 60 * 1000); // Convert ms to hours
    const estimatedTime = selectedItem.estHours || 0;
    const isExceeded = estimatedTime > 0 && totalHoursSpent > estimatedTime ? 1 : 0;

    try {
      // Use the electronAPI to save actHours
      const result = await window.electronAPI.saveActHours({
        taskId: selectedItem.id,
        projectId: selectedItem.projectID || 0, // Make sure to include projectId
        actHours: totalHoursSpent,
        isExceeded
      });

      // Update local state
      const updatedTasks = allTasks.map(task =>
        task.id === selectedItem.id
          ? {
              ...task,
              actHours: totalHoursSpent,
              isExceeded: isExceeded,
              isLocal: result.isLocal || false
            }
          : task
      );
      setAllTasks(updatedTasks);

      return isExceeded;
    } catch (err) {
      console.error('Error saving time:', err);
      throw err;
    }
  };

  const loadInitialActHours = async () => {
    try {
      if (window.electronAPI) {
        const localActHours = await window.electronAPI.loadActHours();
        if (localActHours && Object.keys(localActHours).length > 0) {
          setAllTasks(prevTasks => 
            prevTasks.map(task => ({
              ...task,
              actHours: localActHours[task.id]?.actHours || task.actHours || 0,
              isExceeded: localActHours[task.id]?.isExceeded || task.isExceeded || 0,
              isLocal: localActHours[task.id] !== undefined
            }))
          );
        }
      }
    } catch (error) {
      console.error('Error loading actHours:', error);
    }
  };

  useEffect(() => {
    loadInitialActHours();
  }, []);

  const handleProjectSelect = (projectId) => {
    setSelectedProjectId(projectId);
    // Clear previous tasks when selecting a new project
    setTasks([]);
  };

  const handleSelectionChange = (level, value) => {
    if (level === 'project') {
      handleProjectSelect(value);
    }

    setSelections(prev => {
      const newSelections = { ...prev, [level]: value };
      // Clear all dependent selections when a parent changes
      const levels = ['project', 'task', 'subtask', 'action', 'subaction'];
      const currentIndex = levels.indexOf(level);
      levels.slice(currentIndex + 1).forEach(l => {
        newSelections[l] = '';
      });
      return newSelections;
    });
  };

  // Get available options based on current selections with proper level filtering
  const getOptions = (level) => {
    try {
      switch (level) {
        case 'project':
          return projectsList.map(p => ({
            name: p.name,
            id: p.id
          }));

        case 'task':
          // Explicitly filter for level 1 tasks as an extra safety measure
          const level1Tasks = tasks.filter(task => task.taskLevel === 1);
          console.log('Level 1 tasks for dropdown:', level1Tasks);
          return level1Tasks.map(task => ({
            name: task.name,
            id: task.id
          }));

        case 'subtask':
          if (!selections.task) return [];
          const selectedTask = tasks.find(t => t.name === selections.task);
          if (!selectedTask) return [];

          // Only show level 2 tasks that are children of the selected task
          return allTasks.filter(task =>
            task.taskLevel === 2 &&
            task.parentID == selectedTask.id // Loose equality for type safety
          ).map(task => ({
            name: task.name,
            id: task.id
          }));

        case 'action':
          if (!selections.subtask) return [];
          const selectedSubtask = allTasks.find(t => t.name === selections.subtask);
          if (!selectedSubtask) return [];

          // Only show level 3 tasks that are children of the selected subtask
          return allTasks.filter(task =>
            task.taskLevel === 3 &&
            task.parentID == selectedSubtask.id
          ).map(task => ({
            name: task.name,
            id: task.id
          }));

        case 'subaction':
          if (!selections.action) return [];
          const selectedAction = allTasks.find(t => t.name === selections.action);
          if (!selectedAction) return [];

          // Only show level 4 tasks that are children of the selected action
          return allTasks.filter(task =>
            task.taskLevel === 4 &&
            task.parentID == selectedAction.id
          ).map(task => ({
            name: task.name,
            id: task.id
          }));

        default:
          return [];
      }
    } catch (error) {
      console.error('Error in getOptions:', error);
      return [];
    }
  };


  const takeScreenshotWithCounts = useCallback(async () => {
    try {
      if (window.electronAPI?.takeScreenshot) {
        console.log('Taking screenshot with counts:', {
          mouseClicks: statsRef.current.mouseClicks,
          keyPresses: statsRef.current.keyPresses
        });
        await window.electronAPI.takeScreenshot(
          statsRef.current.mouseClicks,
          statsRef.current.keyPresses
        );
      }
    } catch (error) {
      console.error('Error taking screenshot:', error);
    }
  }, []);


  const handleStartTracking = async () => {
    try {
      const result = await window.electronAPI.startTracking();
      if (result.success) {
        setError(null);
      }
    } catch (err) {
      setError(`Failed to start tracking: ${err.message}`);
    }
  };

  const handlePauseTracking = async () => {
    try {
      const result = await window.electronAPI.stopTracking();
      if (result.success) {
        setError(null);

        // Don't set isTracking to false, just keep it true but paused
      }
    } catch (err) {
      setError(`Failed to pause tracking: ${err.message}`);
    }
  };

  const handleStopTracking = async () => {
    try {
      const result = await window.electronAPI.stopTracking();
      if (result.success) {
        setError(null);
      }
    } catch (err) {
      setError(`Failed to stop tracking: ${err.message}`);
    }
  };

  const clearEvents = () => {
    setEvents([]);
  };

  const formatEvent = (event) => {
    const time = new Date(event.timestamp).toLocaleTimeString();

    switch (event.type) {
      case 'mouseclick':
        const buttonName = event.button === 1 ? 'Left' :
          event.button === 2 ? 'Right' :
            event.button === 3 ? 'Middle' : 'Unknown';
        return `${time} - Mouse ${buttonName} Click at (${event.x}, ${event.y})`;

      case 'mousemove':
        return `${time} - Mouse Move to (${event.x}, ${event.y})`;

      case 'keydown':
        const keyName = KEY_CODES[event.keycode] || `Key[${event.keycode}]`;
        return `${time} - Key Down: ${keyName}`;

      default:
        return `${time} - ${event.type}: ${JSON.stringify(event)}`;
    }
  };

  const [showSettings, setShowSettings] = useState(false);

  const handleSettingsClick = () => {
    setShowSettings(prev => !prev);
  };

  const handleBackFromSettings = () => {
    setShowSettings(false);
  };

  const handleQuitClick = () => {
    if (window.electron) {
      window.electron.quitApp();
    } else {
      console.log('Quit clicked');
    }
  };
  useEffect(() => {
    if (window.electronAPI) {
      setIsElectron(true);
      setApiReady(true);
      console.log('Electron API is available');
    } else {
      setApiReady(true); // Still render UI
      console.warn('Electron API is not available');
    }
  }, []);
  // Remove or comment out this useEffect
  useEffect(() => {
    if (selections.task) {
      const checkExceeded = async () => {
        try {
          const exceeded = isTimeExceeded();
          setShowTimeWarning(exceeded);
        } catch (err) {
          console.error('Error checking time limit:', err);
        }
      };

      checkExceeded();
      const interval = setInterval(checkExceeded, 60000);
      return () => clearInterval(interval);
    }
  }, [selections, timerRunning, elapsedTime]);

  useEffect(() => {
    if (!apiReady || !isElectron || !window.electronAPI?.onGlobalEvent) return;

    // In App.js, update the handleGlobalEvent function
    const handleGlobalEvent = (data) => {
      try {

        if (!data || typeof data !== 'object') {
          return;
        }

        const newEvent = {
          ...data,
          id: Date.now() + Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString()
        };

        setEvents(prev => {
          const updatedEvents = [...prev, newEvent].slice(-maxEvents);
          return updatedEvents;
        });
      } catch (error) {
        console.error('Error in handleGlobalEvent:', error, 'Data:', data);
      }
    };

    const cleanup = window.electronAPI.onGlobalEvent(handleGlobalEvent);
    return () => {
      if (typeof cleanup === 'function') cleanup();
      else if (window.electronAPI?.removeGlobalEventListener) {
        window.electronAPI.removeGlobalEventListener(handleGlobalEvent);
      }
    };
  }, [isElectron, apiReady, maxEvents]);
  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    const cleanupTrackingStatus = window.electronAPI.onTrackingStatus((data) => {
      setIsTracking(data.isTracking);
    });

    const cleanupTrackingError = window.electronAPI.onTrackingError((data) => {
      setError(data.error);
    });

    // Initial status check
    window.electronAPI.getTrackingStatus().then((status) => {
      setIsTracking(status.isTracking);
    });

    return () => {
      cleanupTrackingStatus();
      cleanupTrackingError();
    };
  }, [isElectron]);

  useEffect(() => {
    if (eventsEndRef.current) {
      const eventsContainer = eventsEndRef.current.parentElement;
      if (eventsContainer) {
        eventsContainer.scrollTop = eventsContainer.scrollHeight;
      }
    }
  }, [events]);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);
  useEffect(() => {
    const calculatedStats = { mouseClicks: 0, keyPresses: 0, mouseMoves: 0 };

    events.forEach(event => {
      try {
        if (!event || typeof event !== 'object') {
          return;
        }

        if (!event.type) {
          return;
        }

        switch (event.type) {
          case 'mouseclick':
            calculatedStats.mouseClicks++;
            break;
          case 'keydown':
            calculatedStats.keyPresses++;
            break;
          case 'mousemove':
            calculatedStats.mouseMoves++;
            break;
          default:
            return;
        }
      } catch (error) {
        console.error('Error processing event:', error, 'Event:', event);
      }
    });

    setStats(calculatedStats);
  }, [events]);


  useEffect(() => {
    const fetchAllTasks = async () => {
      try {
        setTasksLoading(true);
        const tasksResponse = await fetch('https://vw.aisrv.in/node_backend/getProjectsV3');

        if (!tasksResponse.ok) {
          throw new Error('Failed to fetch tasks');
        }

        const tasksData = await tasksResponse.json();

        // Process tasks data - adjust this based on the actual API response structure
        if (Array.isArray(tasksData)) {
          setAllTasks(tasksData);
        } else if (tasksData.tasks && Array.isArray(tasksData.tasks)) {
          setAllTasks(tasksData.tasks);
        }
      } catch (err) {
        console.error('Error fetching tasks:', err);
      } finally {
        setTasksLoading(false);
      }
    };

    fetchAllTasks();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setTasks([]);
      return;
    }

    // Find the selected project's ID from projectsList
    const selectedProject = projectsList.find(p => p.name === selectedProjectId);
    if (!selectedProject) {
      setTasks([]);
      return;
    }

    // Filter only level 1 tasks for the selected project
    const filteredTasks = allTasks.filter(task =>
      task.projectID == selectedProject.id && // Use loose equality for type safety
      task.taskLevel === 1
    );

    setTasks(filteredTasks);
  }, [selectedProjectId, allTasks, projectsList]);

  useEffect(() => {
    console.log('Selected Project ID:', selectedProjectId);
    console.log('All tasks:', allTasks);

    if (!selectedProjectId) {
      console.log('No project selected, clearing tasks');
      setTasks([]);
      return;
    }

    // Find the selected project's ID from projectsList
    const selectedProject = projectsList.find(p => p.name === selectedProjectId);
    if (!selectedProject) {
      console.log('Selected project not found in projects list');
      setTasks([]);
      return;
    }

    console.log('Looking for tasks with projectID:', selectedProject.id);

    // Filter tasks that belong to the selected project
    const filteredTasks = allTasks.filter(task =>
      task.projectID === selectedProject.id ||
      task.projectID?.toString() === selectedProject.id.toString() && task.level === 1
    );

    console.log('Filtered tasks for project', selectedProjectId, ':', filteredTasks);
    setTasks(filteredTasks);
  }, [selectedProjectId, allTasks, projectsList]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch projects
        const projectsResponse = await fetch('https://vw.aisrv.in/node_backend/getProjectsV2');
        if (!projectsResponse.ok) {
          throw new Error('Failed to fetch projects');
        }
        const projectsData = await projectsResponse.json();
        console.log('Projects data:', projectsData);

        // Process projects data
        const projectsMap = {};
        const projectsArray = [];

        if (Array.isArray(projectsData)) {
          projectsData.forEach(project => {
            if (project && project.id && project.name) {
              const projectData = {
                id: project.id,
                userID: project.userID,
                name: project.name,
                description: project.description,
                startDate: project.startDate,
                endDate: project.endDate,
                estHours: parseFloat(project.estHours),
                actHours: parseFloat(project.actHours),
                wsID: project.wsID,
                createdAt: project.createdAt,
                modifiedAt: project.modifiedAt
              };
              
              projectsMap[project.name] = projectData;
              projectsArray.push(projectData);
            }
          });
        }

        console.log('Processed projects:', projectsMap);
        setProjects(projectsMap);
        setProjectsList(projectsArray);
        setProjectsList(projectsArray.map(p => ({
          id: p.id,
          name: p.name
        })));
        setLoading(false);
      } catch (err) {
        console.error('Error fetching projects:', err);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // // Take screenshots at regular intervals when tracking is active
  // useEffect(() => {
  //   let interval;

  //   if (isTracking && window.electronAPI) {
  //     // Take initial screenshot after a short delay to ensure we have events
  //     const initialTimeout = setTimeout(() => {
  //       // Set up interval for subsequent screenshots
  //       interval = setInterval(() => {
  //         takeScreenshotWithCounts();
  //       }, 1 * 60 * 1000); // 1 minute
  //     }, 2000); // 2 second delay before first screenshot

  //     return () => {
  //       if (initialTimeout) clearTimeout(initialTimeout);
  //       if (interval) clearInterval(interval);
  //     };
  //   }
  // }, [isTracking, takeScreenshotWithCounts]); 
  useEffect(() => {
    if (!timerRunning) {
      const selectedTask = tasks.find(t => t.name === selections.task);
      const selectedSubtask = selections.subtask ? allTasks.find(t => t.name === selections.subtask) : null;
      const selectedAction = selections.action ? allTasks.find(t => t.name === selections.action) : null;
      const selectedSubaction = selections.subaction ? allTasks.find(t => t.name === selections.subaction) : null;
      const selectedItem = selectedSubaction || selectedAction || selectedSubtask || selectedTask;

      if (selectedItem?.actHours) {
        setBaseActualTime(selectedItem.actHours * 3600000);
        setElapsedTime(selectedItem.actHours * 3600000);
      } else {
        setBaseActualTime(0);
        setElapsedTime(0);
      }
    }
  }, [selections.task, selections.subtask, selections.action, selections.subaction, tasks, allTasks, timerRunning]);
  useEffect(() => {
    loadInitialActHours();
  }, [loadInitialActHours]);

  const renderSelectionUI = () => {
    return (
      <div className="selection-container">
        <h2>Task Selection</h2>
        <div className="dropdown-group">
          <select
            value={selections.project}
            onChange={(e) => handleSelectionChange('project', e.target.value)}
            className="dropdown"
          >
            <option value="">Select Project</option>
            {projectsList.map(project => (
              <option key={project.id} value={project.name}>
                {project.name}
              </option>
            ))}
          </select>

          {selections.project && (
            <select
              value={selections.task}
              onChange={(e) => handleSelectionChange('task', e.target.value)}
              className="dropdown"
            >
              <option value="">
                {tasksLoading ? 'Loading tasks...' : getOptions('task').length === 0 ? 'No tasks found' : 'Select Task'}
              </option>
              {getOptions('task').map(task => (
                <option key={task.id} value={task.name}>
                  {task.name}
                </option>
              ))}
            </select>
          )}

          {selections.task && (
            <select
              value={selections.subtask}
              onChange={(e) => handleSelectionChange('subtask', e.target.value)}
              className="dropdown"
            >
              <option value="">
                {getOptions('subtask').length === 0 ? 'No subtasks available' : 'Select Subtask'}
              </option>
              {getOptions('subtask').map(subtask => (
                <option key={subtask.id} value={subtask.name}>
                  {subtask.name}
                </option>
              ))}
            </select>
          )}

          {selections.subtask && (
            <select
              value={selections.action}
              onChange={(e) => handleSelectionChange('action', e.target.value)}
              className="dropdown"
            >
              <option value="">
                {getOptions('action').length === 0 ? 'No action items available' : 'Select Action'}
              </option>
              {getOptions('action').map(action => (
                <option key={action.id} value={action.name}>
                  {action.name}
                </option>
              ))}
            </select>
          )}

          {selections.action && (
            <select
              value={selections.subaction}
              onChange={(e) => handleSelectionChange('subaction', e.target.value)}
              className="dropdown"
            >
              <option value="">
                {getOptions('subaction').length === 0 ? 'No subaction items available' : 'Select Subaction'}
              </option>
              {getOptions('subaction').map(subaction => (
                <option key={subaction.id} value={subaction.name}>
                  {subaction.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={startTimer}
            disabled={!selections.project || !selections.task}
            className="start-timer-btn"
          >
            Start Timer
          </button>
        </div>
      </div>
    );
  };

  const renderTimerUI = () => {
    const isDarkMode = document.body.classList.contains('dark-theme');


    return (
      <div className="tracker-container">
        <button
          onClick={stopTimer}
          className="back-button"
          title="Go back to selection"
        >
          Back
        </button>

        <div className="estimated-time-card">
          <div className="estimated-time-header">
            <h3>Estimated Time</h3>
          </div>
          <div className="estimated-time-value">
            {getEstimatedTime()}
          </div>
        </div>
        <div className="estimated-time-card">
          <div className="estimated-time-header">
            <h3>Actual Time</h3>
          </div>
          <div className="estimated-time-value">
            {formatActualTime(elapsedTime)}
          </div>
        </div>


        <div className="timer-display">
          <h2>Time Tracking {!timerRunning && isTracking ? '(Paused)' : ''}</h2>
          <div className={`time ${!timerRunning && isTracking ? 'paused' : ''}`}>
            {formatTime(elapsedTime)}
          </div>

          {/* Activity Metrics */}
          <div className="activity-metrics">
            <h3 className="metrics-title">Activity Metrics</h3>
            <div className="metrics-grid">
              <div className={`metric-card ${isDarkMode ? 'keyboard-dark' : 'keyboard-light'}`}>
                <div className={`metric-icon ${isDarkMode ? 'keyboard-icon-dark' : 'keyboard-icon-light'}`}>
                  <Keyboard className="metric-svg" />
                </div>
                <div className="metric-details">
                  <p className="metric-label">Keystrokes</p>
                  <p className={`metric-value ${isDarkMode ? 'keyboard-text-dark' : 'keyboard-text-light'}`}>
                    {stats.keyPresses || 0}
                  </p>
                </div>
              </div>

              <div className={`metric-card ${isDarkMode ? 'mouse-dark' : 'mouse-light'}`}>
                <div className={`metric-icon ${isDarkMode ? 'mouse-icon-dark' : 'mouse-icon-light'}`}>
                  <MousePointerClick className="metric-svg" />
                </div>
                <div className="metric-details">
                  <p className="metric-label">Mouse Clicks</p>
                  <p className={`metric-value ${isDarkMode ? 'mouse-text-dark' : 'mouse-text-light'}`}>
                    {stats.mouseClicks || 0}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="selection-info">
            <p>
              {[
                selections.project,
                selections.task,
                selections.subtask,
                selections.action,
                selections.subaction
              ]
                .filter(Boolean)
                .map((item, index, array) => (
                  <span key={index}>
                    <strong>{item}</strong>
                    {index < array.length - 1 && ' → '}
                  </span>
                ))}
            </p>
          </div>
        </div>

        <div className="controls">
          {timerRunning ? (
            <button
              onClick={pauseTimer}
              className="stop-btn"
              disabled={!!error && error.includes('Electron API not available')}
            >
              Pause
            </button>
          ) : (
            <button
              onClick={startTimer}
              className="start-btn"
              disabled={!!error && error.includes('Electron API not available')}
            >
              Resume
            </button>
          )}

          <button
            onClick={stopTimer}
            className="reset-all-btn"
            disabled={!isTracking && events.length === 0}
          >
            Punch Out
          </button>
        </div>

        {error && (
          <div className="error">
            <strong>⚠️ Error:</strong> {error}
          </div>
        )}

        {/* Last Screenshot Section */}
        <div className="screenshot-section">
          <div className="screenshot-card">
            <h3>📸 Last Screenshot</h3>
            <div className="screenshot-container">
              {lastScreenshot ? (
                <img
                  src={`file://${lastScreenshot.path}`}
                  alt="Last screenshot"
                  className="screenshot-image"
                />
              ) : (
                <p className="no-screenshot">No screenshot available</p>
              )}
            </div>
          </div>
        </div>

        {showTimeWarning && (
          <div className="time-limit-card">
            <span className="icon">⚠️</span>
            <div className="content">
              <div className="title">Time Limit Exceeded</div>
              <div className="message">
                You've exceeded the estimated time for this task.
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ThemeProvider>
      <TaskProvider>
        <div className="app">
          <Navbar
            title={showSettings ? 'Settings' : (showTracker ? 'Timer' : 'Selection')}
            onSettingsClick={handleSettingsClick}
            onQuitClick={handleQuitClick}
          />

          <CSSTransition
            in={!showSettings}
            timeout={300}
            classNames="slide"
            unmountOnExit
          >
            <div className="main-content">
              {!showTracker ? renderSelectionUI() : renderTimerUI()}
            </div>
          </CSSTransition>

          <CSSTransition
            in={showSettings}
            timeout={300}
            classNames="slide"
            unmountOnExit
          >
            <div className="settings-container">
              <SettingsPage
                onBackClick={handleBackFromSettings}
                onQuitClick={handleQuitClick}
              />
            </div>
          </CSSTransition>
        </div>
      </TaskProvider>
    </ThemeProvider>
  );
}

export default App;