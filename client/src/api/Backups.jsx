import axios from "axios";

const API_URL =
  (import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000") + "/api";

export const fetchDatabases = async () => {
  try {
    const response = await axios.get(`${API_URL}/db-info/`);
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching database info:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const fetchBackups = async (dbName) => {
  try {
    const params = dbName ? { db_name: dbName } : {};
    const response = await axios.get(`${API_URL}/backups/`, { params });
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching backups:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const createBackup = async (dbName) => {
  try {
    const response = await axios.post(`${API_URL}/backups/create/`, {
      db_name: dbName,
    });
    return response.data;
  } catch (error) {
    console.error(
      "Error creating backup:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const getBackupStatus = async (backupId) => {
  try {
    const response = await axios.get(`${API_URL}/backups/${backupId}/`);
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching backup status:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const deleteBackup = async (backupId) => {
  try {
    const response = await axios.delete(
      `${API_URL}/backups/${backupId}/delete/`,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error deleting backup:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const restoreBackup = async (backupId) => {
  try {
    const response = await axios.post(
      `${API_URL}/backups/${backupId}/restore/`,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error restoring backup:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const fetchHealthChecks = async (dbName) => {
  try {
    const params = dbName ? { db_name: dbName } : {};
    const response = await axios.get(`${API_URL}/health-checks/`, { params });
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching health checks:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const runHealthCheck = async (dbName) => {
  try {
    const response = await axios.post(`${API_URL}/health-checks/run/`, {
      db_name: dbName,
    });
    return response.data;
  } catch (error) {
    console.error(
      "Error running health check:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const fetchSchedules = async (dbName) => {
  try {
    const params = dbName ? { db_name: dbName } : {};
    const response = await axios.get(`${API_URL}/schedules/`, { params });
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching schedules:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const saveSchedule = async (scheduleData) => {
  try {
    const response = await axios.post(
      `${API_URL}/schedules/save/`,
      scheduleData,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error saving schedule:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const toggleSchedule = async (scheduleId) => {
  try {
    const response = await axios.post(
      `${API_URL}/schedules/${scheduleId}/toggle/`,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error toggling schedule:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const deleteSchedule = async (scheduleId) => {
  try {
    const response = await axios.delete(
      `${API_URL}/schedules/${scheduleId}/delete/`,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error deleting schedule:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const previewNextRuns = async (scheduleData) => {
  try {
    const response = await axios.post(
      `${API_URL}/schedules/preview/`,
      scheduleData,
    );
    return response.data;
  } catch (error) {
    console.error(
      "Error previewing next runs:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const fetchRestores = async (dbName) => {
  try {
    const params = dbName ? { db_name: dbName } : {};
    const response = await axios.get(`${API_URL}/restores/`, { params });
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching restores:",
      error.response?.data || error.message,
    );
    throw error;
  }
};

export const getRestoreStatus = async (restoreId) => {
  try {
    const response = await axios.get(`${API_URL}/restores/${restoreId}/`);
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching restore status:",
      error.response?.data || error.message,
    );
    throw error;
  }
};
