export const formatDateTime = (dateString) => {
  if (!dateString) return '-'
  
  // SQLite CURRENT_TIMESTAMP 返回的格式是 YYYY-MM-DD HH:MM:SS (UTC 时间)
  // 如果字符串没有带时区后缀，在浏览器解析时可能会被当成本地时间解析
  // 所以需要手动补上 Z，让浏览器知道这是 UTC 时间
  let str = dateString.trim()
  if (str.length === 19 && !str.includes('T')) {
    str = str.replace(' ', 'T') + 'Z'
  }
  
  const d = new Date(str)
  if (isNaN(d.getTime())) return dateString

  return d.toLocaleString()
}
