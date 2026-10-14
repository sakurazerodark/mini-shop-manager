import axios from 'axios'

// Determine the base URL dynamically.
// In Electron production (file://), point to the local Express server.
// In development, use relative path '/api' which Vite proxies.
const getBaseUrl = () => {
  if (window.location.protocol === 'file:') {
    return 'http://localhost:8080/api'
  }
  return '/api'
}

const request = axios.create({
  baseURL: getBaseUrl(),
  timeout: 10000,
})

request.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem('mini-shop-auth-token')
    if (token) config.headers.Authorization = `Bearer ${token}`
  } catch {
    // localStorage may be unavailable in a restricted webview.
  }
  return config
})

request.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    const status = error.response?.status
    if ((status === 401 || status === 403) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:error', { detail: { status, data: error.response?.data } }))
    }
    if (error.response && error.response.data) {
      const payload = error.response.data
      if (payload && typeof payload === 'object') payload.status = status
      return Promise.reject(payload)
    }
    return Promise.reject(error)
  }
)

export default request
