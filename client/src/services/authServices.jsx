import axiosInstance from "../context/axiosInstance";

export const handleLogin = async (username, password) => {
  try {
    const response = await axiosInstance.post("/login/", {
      username,
      password,
    });
    const token = response.data.token;
    localStorage.setItem("authToken", token);
    console.log("User logged in successfully");
    return response.data;
  } catch (error) {
    console.error("Error during login:", error.message);
    throw error;
  }
};
