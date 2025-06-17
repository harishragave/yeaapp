import React, { createContext, useContext } from 'react';

const TaskContext = createContext();

export const TaskProvider = ({ children }) => {
  // Add any task-related state or methods here if needed
  
  return (
    <TaskContext.Provider value={{}}>
      {children}
    </TaskContext.Provider>
  );
};

export const useTaskContext = () => {
  const context = useContext(TaskContext);
  if (!context) {
    throw new Error('useTaskContext must be used within a TaskProvider');
  }
  return context;
};
