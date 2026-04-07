import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000";
const normalizedBackendUrl = backendUrl.replace(/\/+$/, "");
const apiBaseUrl = `${normalizedBackendUrl}/api`;

const axiosInstance = axios.create({
  baseURL: apiBaseUrl,
});

axiosInstance.interceptors.request.use((config) => {
  const token = localStorage.getItem("authToken");
  if (token) {
    config.headers.Authorization = `Token ${token}`;
  }
  return config;
});

export default axiosInstance;
