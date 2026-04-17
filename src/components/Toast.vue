<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const toasts = ref([])
let toastId = 0

const showToast = (message, type = 'info', durationOrOptions = 3000) => {
  const options = typeof durationOrOptions === 'object' && durationOrOptions !== null ? durationOrOptions : {}
  const duration = typeof durationOrOptions === 'number' ? durationOrOptions : (options.duration ?? 3000)
  const size = options.size || 'md'
  const id = toastId++
  toasts.value.push({ id, message, type, size })
  
  setTimeout(() => {
    removeToast(id)
  }, duration)
}

const removeToast = (id) => {
  const index = toasts.value.findIndex(t => t.id === id)
  if (index !== -1) {
    toasts.value.splice(index, 1)
  }
}

// 将方法挂载到 window 对象，方便在没有提供 provide/inject 的旧代码中直接调用
onMounted(() => {
  window.$toast = showToast
})

onUnmounted(() => {
  if (window.$toast === showToast) {
    delete window.$toast
  }
})
</script>

<template>
  <div class="toast-container">
    <TransitionGroup name="toast">
      <div 
        v-for="toast in toasts" 
        :key="toast.id" 
        :class="['toast-item', `toast-${toast.type}`, toast.size === 'lg' ? 'toast-lg' : '']"
      >
        <span class="toast-icon" v-if="toast.type === 'success'">✓</span>
        <span class="toast-icon" v-if="toast.type === 'error'">!</span>
        <span class="toast-icon" v-if="toast.type === 'warning'">⚠</span>
        <span class="toast-icon" v-if="toast.type === 'info'">i</span>
        <span class="toast-message">{{ toast.message }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  padding: 12px 24px;
  background: var(--surface);
  border-radius: var(--radius-full);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.15);
  font-size: 15px;
  font-weight: 500;
  color: var(--text-main);
  pointer-events: auto;
  border: 1px solid var(--border-color);
  min-width: 280px;
  max-width: calc(100vw - 32px);
}

.toast-lg {
  padding: 16px 28px;
  font-size: 18px;
  font-weight: 700;
  min-width: 0;
  width: min(520px, calc(100vw - 32px));
}

.toast-lg .toast-icon {
  width: 26px;
  height: 26px;
  font-size: 14px;
}

.toast-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  margin-right: 12px;
  font-size: 12px;
  font-weight: bold;
  color: white;
}

.toast-success .toast-icon { background-color: var(--success); }
.toast-error .toast-icon { background-color: var(--danger); }
.toast-warning .toast-icon { background-color: var(--warning); }
.toast-info .toast-icon { background-color: var(--primary); }

.toast-enter-active,
.toast-leave-active {
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(-20px) scale(0.9);
}
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.95);
}
</style>
