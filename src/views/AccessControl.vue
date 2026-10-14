<script setup>
import { computed, onMounted, ref } from 'vue'
import {
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  getRolePermissions,
  listPermissions,
  listRoles,
  listUsers,
  permissionCatalog,
  updateRole,
  updateRolePermissions,
  updateUser
} from '../api/auth'
import { hasPermission } from '../store'

const activeTab = ref('users')
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const users = ref([])
const roles = ref([])
const permissions = ref([...permissionCatalog])
const selectedRoleId = ref('')
const rolePermissions = ref([])
const search = ref('')
const showUserForm = ref(false)
const showRoleForm = ref(false)
const editingUser = ref(null)
const editingRole = ref(null)
const userForm = ref({ username: '', display_name: '', password: '', role_id: '', enabled: true })
const roleForm = ref({ name: '', description: '' })

const canViewAccounts = computed(() => hasPermission('account.view'))
const canManageAccounts = computed(() => hasPermission('account.manage'))
const canViewRoles = computed(() => hasPermission('role.view'))
const canManageRoles = computed(() => hasPermission('role.manage'))
const filteredUsers = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return users.value
  return users.value.filter(user => [user.username, user.display_name, user.name].filter(Boolean).join(' ').toLowerCase().includes(query))
})

const unwrapList = (payload, key) => {
  const data = payload?.data ?? payload
  if (Array.isArray(data)) return data
  return data?.items || data?.[key] || []
}

const notify = (message, type = 'info') => {
  if (typeof window !== 'undefined' && window.$toast) window.$toast(message, type)
}

const loadUsers = async () => {
  if (!canViewAccounts.value) return
  try {
    const payload = await listUsers({ page: 1, pageSize: 100, search: search.value || undefined })
    users.value = unwrapList(payload, 'users')
  } catch (error) {
    if (error?.status === 403) errorMessage.value = '当前账号没有查看账号的权限'
    else errorMessage.value = error?.error || error?.message || '账号列表加载失败'
  }
}

const loadRoles = async () => {
  if (!canViewRoles.value) return
  try {
    const payload = await listRoles({ page: 1, pageSize: 100 })
    roles.value = unwrapList(payload, 'roles')
    if (!selectedRoleId.value && roles.value.length) selectedRoleId.value = roles.value[0].id
    if (selectedRoleId.value) await loadRolePermissions(selectedRoleId.value)
  } catch (error) {
    if (error?.status === 403) errorMessage.value = '当前账号没有查看角色的权限'
    else errorMessage.value = error?.error || error?.message || '角色列表加载失败'
  }
}

const loadRolePermissions = async (roleId) => {
  if (!roleId) return
  try {
    const payload = await getRolePermissions(roleId)
    const data = payload?.data ?? payload
    const rawPermissions = data?.permissions || data?.permission_codes || (Array.isArray(data) ? data : [])
    rolePermissions.value = Array.isArray(rawPermissions)
      ? rawPermissions.map(item => typeof item === 'string' ? item : item?.code || item?.permission_key || item?.key).filter(Boolean)
      : []
  } catch (error) {
    rolePermissions.value = []
    if (error?.status === 403) errorMessage.value = '当前账号没有查看角色权限的权限'
  }
}

const loadPermissions = async () => {
  try {
    const payload = await listPermissions()
    const list = unwrapList(payload, 'permissions')
    if (list.length) permissions.value = list.map(item => typeof item === 'string'
      ? { code: item, label: item }
      : { ...item, code: item.code || item.permission_key || item.key, label: item.label || item.name || item.permission_key || item.code })
  } catch {
    // The catalog keeps the page useful while an older server does not expose this endpoint.
  }
}

const refresh = async () => {
  loading.value = true
  errorMessage.value = ''
  await Promise.all([loadUsers(), loadRoles(), loadPermissions()])
  loading.value = false
}

const openNewUser = () => {
  editingUser.value = null
  userForm.value = { username: '', display_name: '', password: '', role_id: roles.value[0]?.id || '', enabled: true }
  showUserForm.value = true
}

const openEditUser = (user) => {
  editingUser.value = user
  userForm.value = { username: user.username || '', display_name: user.display_name || user.name || '', password: '', role_id: user.role_id || user.role?.id || '', enabled: user.enabled !== false && user.status !== 'disabled' }
  showUserForm.value = true
}

const saveUser = async () => {
  if (!userForm.value.username.trim()) return notify('请输入登录账号', 'warning')
  saving.value = true
  try {
    const payload = {
      username: userForm.value.username.trim(),
      display_name: userForm.value.display_name.trim(),
      status: userForm.value.enabled ? 'active' : 'disabled',
      role_ids: userForm.value.role_id ? [Number(userForm.value.role_id)] : []
    }
    if (userForm.value.password) payload.password = userForm.value.password
    if (editingUser.value) await updateUser(editingUser.value.id, payload)
    else await createUser(payload)
    notify(editingUser.value ? '账号已更新' : '账号已创建', 'success')
    showUserForm.value = false
    await loadUsers()
  } catch (error) {
    notify(error?.error || error?.message || '保存账号失败', 'error')
  } finally {
    saving.value = false
  }
}

const toggleUser = async (user) => {
  try {
    await updateUser(user.id, { status: user.status === 'disabled' ? 'active' : 'disabled' })
    await loadUsers()
    notify('账号状态已更新', 'success')
  } catch (error) {
    notify(error?.error || error?.message || '更新账号状态失败', 'error')
  }
}

const removeUser = async (user) => {
  if (!confirm(`确定删除账号“${user.display_name || user.username}”吗？`)) return
  try {
    await deleteUser(user.id)
    await loadUsers()
    notify('账号已删除', 'success')
  } catch (error) {
    notify(error?.error || error?.message || '删除账号失败', 'error')
  }
}

const openNewRole = () => {
  editingRole.value = null
  roleForm.value = { name: '', description: '' }
  showRoleForm.value = true
}

const openEditRole = (role) => {
  editingRole.value = role
  roleForm.value = { name: role.name || '', description: role.description || '' }
  showRoleForm.value = true
}

const saveRole = async () => {
  if (!roleForm.value.name.trim()) return notify('请输入角色名称', 'warning')
  saving.value = true
  try {
    const payload = { name: roleForm.value.name.trim(), description: roleForm.value.description.trim() }
    if (editingRole.value) await updateRole(editingRole.value.id, payload)
    else await createRole(payload)
    notify(editingRole.value ? '角色已更新' : '角色已创建', 'success')
    showRoleForm.value = false
    await loadRoles()
  } catch (error) {
    notify(error?.error || error?.message || '保存角色失败', 'error')
  } finally {
    saving.value = false
  }
}

const removeRole = async (role) => {
  if (!confirm(`确定删除角色“${role.name}”吗？`)) return
  try {
    await deleteRole(role.id)
    if (selectedRoleId.value === role.id) selectedRoleId.value = ''
    await loadRoles()
    notify('角色已删除', 'success')
  } catch (error) {
    notify(error?.error || error?.message || '删除角色失败', 'error')
  }
}

const saveRolePermissions = async () => {
  if (!selectedRoleId.value) return
  saving.value = true
  try {
    await updateRolePermissions(selectedRoleId.value, rolePermissions.value)
    notify('角色权限已保存', 'success')
  } catch (error) {
    notify(error?.error || error?.message || '保存角色权限失败', 'error')
  } finally {
    saving.value = false
  }
}

const permissionChecked = (code) => rolePermissions.value.includes(code)
const togglePermission = (code) => {
  rolePermissions.value = permissionChecked(code)
    ? rolePermissions.value.filter(item => item !== code)
    : [...rolePermissions.value, code]
}

onMounted(refresh)
</script>

<template>
  <div class="access-page">
    <header class="access-header">
      <div>
        <p class="eyebrow">安全与治理</p>
        <h1>用户与权限</h1>
        <p class="muted">管理账号、角色和资源操作权限，所有变更由服务端校验并记录审计日志。</p>
      </div>
      <button class="btn btn-secondary" type="button" @click="refresh" :disabled="loading">{{ loading ? '刷新中…' : '刷新' }}</button>
    </header>

    <div v-if="errorMessage" class="access-alert access-alert-error">{{ errorMessage }}</div>

    <div class="access-tabs" role="tablist">
      <button class="access-tab" :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">账号</button>
      <button class="access-tab" :class="{ active: activeTab === 'roles' }" @click="activeTab = 'roles'">角色与权限</button>
    </div>

    <section v-if="activeTab === 'users'" class="access-panel">
      <div v-if="!canViewAccounts" class="empty-state">你没有查看账号的权限。</div>
      <template v-else>
        <div class="panel-toolbar">
          <input v-model="search" class="form-input search-input" placeholder="搜索账号或姓名" @keyup.enter="loadUsers" />
          <button v-if="canManageAccounts" class="btn btn-primary" type="button" @click="openNewUser">新增账号</button>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>状态</th><th>最近登录</th><th class="actions-col">操作</th></tr></thead>
            <tbody>
              <tr v-for="user in filteredUsers" :key="user.id">
                <td><strong>{{ user.username }}</strong></td>
                <td>{{ user.display_name || user.name || '—' }}</td>
                <td>{{ user.roles?.map(role => role.name).join(', ') || user.role?.name || user.role_name || '未分配' }}</td>
                <td><span class="status-dot" :class="{ off: user.enabled === false || user.status === 'disabled' }">{{ user.enabled === false || user.status === 'disabled' ? '停用' : '启用' }}</span></td>
                <td class="muted">{{ user.last_login_at || user.lastLoginAt || '—' }}</td>
                <td class="actions-col" v-if="canManageAccounts"><button class="link-btn" @click="openEditUser(user)">编辑</button><button class="link-btn" @click="toggleUser(user)">{{ user.enabled === false || user.status === 'disabled' ? '启用' : '停用' }}</button><button class="link-btn danger" @click="removeUser(user)">删除</button></td>
                <td v-else class="muted">—</td>
              </tr>
              <tr v-if="!filteredUsers.length"><td colspan="6" class="empty-cell">暂无账号</td></tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <section v-else class="access-panel role-layout">
      <div v-if="!canViewRoles" class="empty-state">你没有查看角色的权限。</div>
      <template v-else>
        <div class="role-list">
          <div class="panel-toolbar"><strong>角色</strong><button v-if="canManageRoles" class="btn btn-primary btn-small" @click="openNewRole">新增</button></div>
          <button v-for="role in roles" :key="role.id" class="role-row" :class="{ selected: selectedRoleId === role.id }" @click="selectedRoleId = role.id; loadRolePermissions(role.id)"><span><strong>{{ role.name }}</strong><small>{{ role.description || '暂无描述' }}</small></span><span class="role-count">{{ role.user_count ?? role.userCount ?? 0 }}人</span></button>
          <div v-if="!roles.length" class="empty-state compact">暂无角色</div>
        </div>
        <div class="permission-panel">
          <div class="panel-toolbar"><div><strong>{{ roles.find(item => item.id === selectedRoleId)?.name || '选择角色' }}</strong><p class="muted">勾选资源操作权限</p></div><button v-if="canManageRoles && selectedRoleId" class="btn btn-primary" @click="saveRolePermissions" :disabled="saving">保存权限</button></div>
          <div v-if="selectedRoleId" class="permission-grid"><label v-for="permission in permissions" :key="permission.code" class="permission-item"><input type="checkbox" :checked="permissionChecked(permission.code)" :disabled="!canManageRoles" @change="togglePermission(permission.code)" /><span><strong>{{ permission.label || permission.name || permission.code }}</strong><code>{{ permission.code }}</code></span></label></div>
          <div v-else class="empty-state">请选择一个角色查看权限。</div>
        </div>
      </template>
    </section>

    <div v-if="showUserForm" class="modal-backdrop" @click.self="showUserForm = false"><form class="access-modal" @submit.prevent="saveUser"><div class="modal-head"><h2>{{ editingUser ? '编辑账号' : '新增账号' }}</h2><button type="button" class="icon-btn" @click="showUserForm = false">×</button></div><label>登录账号<input v-model="userForm.username" class="form-input" required /></label><label>显示姓名<input v-model="userForm.display_name" class="form-input" /></label><label>密码<input v-model="userForm.password" class="form-input" type="password" :placeholder="editingUser ? '留空表示不修改' : '设置初始密码'" :required="!editingUser" /></label><label>角色<select v-model="userForm.role_id" class="form-input"><option value="">未分配</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label><label class="check-line"><input v-model="userForm.enabled" type="checkbox" />账号启用</label><div class="modal-actions"><button type="button" class="btn btn-secondary" @click="showUserForm = false">取消</button><button class="btn btn-primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div></form></div>
    <div v-if="showRoleForm" class="modal-backdrop" @click.self="showRoleForm = false"><form class="access-modal" @submit.prevent="saveRole"><div class="modal-head"><h2>{{ editingRole ? '编辑角色' : '新增角色' }}</h2><button type="button" class="icon-btn" @click="showRoleForm = false">×</button></div><label>角色名称<input v-model="roleForm.name" class="form-input" required /></label><label>描述<textarea v-model="roleForm.description" class="form-input" rows="3"></textarea></label><div class="modal-actions"><button type="button" class="btn btn-secondary" @click="showRoleForm = false">取消</button><button class="btn btn-primary" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div></form></div>
  </div>
</template>

<style scoped>
.access-page { padding: 28px; min-height: 100%; color: var(--text-main); }
.access-header { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; margin-bottom:22px; }
.eyebrow { margin:0 0 6px; color:var(--primary); font-size:12px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
h1 { margin:0; font-size:28px; letter-spacing:0; }
.muted { color:var(--text-muted); font-size:13px; margin:6px 0 0; }
.access-alert { padding:12px 14px; border-radius:8px; margin-bottom:16px; font-size:13px; }
.access-alert-error { background:var(--danger-bg); color:#991b1b; border:1px solid #fecaca; }
.access-tabs { display:flex; gap:20px; border-bottom:1px solid var(--border-color); margin-bottom:18px; }
.access-tab { border:0; border-bottom:2px solid transparent; background:none; padding:10px 2px; color:var(--text-muted); font-weight:700; cursor:pointer; }
.access-tab.active { color:var(--primary); border-bottom-color:var(--primary); }
.access-panel { background:var(--surface); border:1px solid var(--border-color); border-radius:10px; box-shadow:var(--shadow-sm); min-height:360px; }
.panel-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border-bottom:1px solid var(--border-color); }
.search-input { max-width:320px; }
.btn-small { padding:6px 10px; font-size:12px; }
.table-wrap { overflow:auto; }
.data-table { width:100%; border-collapse:collapse; font-size:13px; }
.data-table th, .data-table td { text-align:left; padding:13px 18px; border-bottom:1px solid #eef2f7; white-space:nowrap; }
.data-table th { color:var(--text-muted); font-size:12px; font-weight:700; background:#f8fafc; }
.actions-col { text-align:right !important; }
.status-dot { color:#047857; font-weight:700; }
.status-dot::before { content:'●'; margin-right:5px; font-size:9px; }
.status-dot.off { color:#b45309; }
.link-btn { border:0; background:none; color:var(--primary); cursor:pointer; margin-left:12px; padding:0; font-size:12px; }
.link-btn.danger { color:var(--danger); }
.empty-cell, .empty-state { color:var(--text-muted); text-align:center; padding:42px 20px !important; }
.empty-state.compact { padding:20px !important; }
.role-layout { display:grid; grid-template-columns:280px 1fr; }
.role-list { border-right:1px solid var(--border-color); }
.role-row { width:100%; display:flex; justify-content:space-between; align-items:center; gap:8px; padding:14px 18px; border:0; border-bottom:1px solid #eef2f7; background:var(--surface); text-align:left; cursor:pointer; }
.role-row:hover, .role-row.selected { background:#f5f7ff; }
.role-row small { display:block; color:var(--text-muted); margin-top:4px; font-size:11px; }
.role-count { color:var(--text-muted); font-size:12px; }
.permission-panel { min-width:0; }
.permission-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:10px; padding:18px; }
.permission-item { display:flex; gap:10px; padding:12px; border:1px solid var(--border-color); border-radius:7px; cursor:pointer; }
.permission-item:has(input:checked) { border-color:#a5b4fc; background:#f5f7ff; }
.permission-item span { min-width:0; }
.permission-item strong { display:block; font-size:13px; }
.permission-item code { display:block; color:var(--text-muted); font-size:10px; margin-top:3px; overflow-wrap:anywhere; }
.modal-backdrop { position:fixed; inset:0; z-index:100; display:grid; place-items:center; padding:20px; background:rgba(15,23,42,.45); }
.access-modal { width:min(460px,100%); display:flex; flex-direction:column; gap:14px; padding:22px; background:var(--surface); border-radius:10px; box-shadow:var(--shadow-lg); }
.access-modal label { display:flex; flex-direction:column; gap:7px; font-size:13px; font-weight:700; }
.modal-head { display:flex; align-items:center; justify-content:space-between; }
.modal-head h2 { margin:0; font-size:18px; }
.icon-btn { border:0; background:none; color:var(--text-muted); font-size:24px; cursor:pointer; line-height:1; }
.check-line { flex-direction:row !important; align-items:center; }
.modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
@media (max-width: 760px) { .access-page { padding:18px 14px 92px; } .access-header { flex-direction:column; } .role-layout { grid-template-columns:1fr; } .role-list { border-right:0; border-bottom:1px solid var(--border-color); } .permission-grid { grid-template-columns:1fr; } .panel-toolbar { flex-wrap:wrap; } .search-input { max-width:none; width:100%; } }
</style>
