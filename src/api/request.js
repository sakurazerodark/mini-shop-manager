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

request.interceptors.response.use(
  (response) => {
    return response.data
  },
  (error) => {
    if (error.response && error.response.data) {
      return Promise.reject(error.response.data)
    }
    return Promise.reject(error)
  }
)

export default request
