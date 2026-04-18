<script setup>
import { ref, onMounted } from 'vue'
import { getBasicSettings, updateBasicSettings, getBarcodeLookup, updateBarcodeLookup, getPayments, updatePayments, getDataDir, selectDataDir, migrateDataDir, getNetworkConfig, updateNetworkConfig } from '../api/settings'
import { lookupBarcode } from '../api/products'
import { globalStoreName } from '../store'

const currentTab = ref('basic') // 'basic', 'payment'
const paymentTab = ref('alipay')

const storeName = ref('店小易')
const isSavingBasic = ref(false)

const currentDataDir = ref('')
const isElectron = ref(false)
const isMigratingData = ref(false)

const networkConfig = ref({ remote_access: false, local_ip: '127.0.0.1', port: 8080 })
const isSavingNetwork = ref(false)

const provider = ref('tanshuapi')
const tanshuapiKey = ref('')
const tanshuapiKeySet = ref(false)
const isSaving = ref(false)

const payment = ref({
  wechatpay_v3: {
    mchid: '',
    appid: '',
    serial_no: '',
    notify_url: '',
    api_v3_key: '',
    merchant_private_key: '',
    platform_cert: ''
  },
  alipay_f2f: {
    app_id: '',
    gateway: 'https://openapi.alipay.com/gateway.do',
    merchant_private_key: '',
    alipay_public_key: '',
    encrypt_key: '',
    notify_url: ''
  },
  unionpay: {
    merchant_id: '',
    gateway: '',
    notify_url: '',
    sign_key: '',
    sign_cert: '',
    verify_cert: ''
  }
})
const paymentStatus = ref(null)
const isSavingPayment = ref(false)
const pollIntervalSec = ref(2)

const testBarcode = ref('')
const testResult = ref(null)
const isTesting = ref(false)

const fetchSettings = async () => {
  try {
    const resBasic = await getBasicSettings().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (resBasic.ok) {
      const jsonBasic = await resBasic.json()
      storeName.value = jsonBasic?.data?.store_name || '店小易'
    }

    const resDataDir = await getDataDir().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (resDataDir.ok) {
      const jsonDir = await resDataDir.json()
      currentDataDir.value = jsonDir?.data?.path || ''
      isElectron.value = jsonDir?.data?.is_electron || false
    }

    const res = await getBarcodeLookup().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      provider.value = json?.data?.provider || 'tanshuapi'
      tanshuapiKeySet.value = Boolean(json?.data?.tanshuapi_key_set)
    }

    const resNetwork = await getNetworkConfig().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (resNetwork.ok) {
      const jsonNetwork = await resNetwork.json()
      networkConfig.value.remote_access = jsonNetwork?.data?.remote_access || false
      networkConfig.value.local_ip = jsonNetwork?.data?.local_ip || '127.0.0.1'
      networkConfig.value.port = jsonNetwork?.data?.port || 8080
    }
  } catch (e) {
    console.error(e)
  }
}

const fetchPaymentSettings = async () => {
  try {
    const res = await getPayments().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!res.ok) return
    const json = await res.json()
    paymentStatus.value = json?.data || null
    pollIntervalSec.value = Math.max(1, Math.floor(Number(paymentStatus.value?.poll_interval_ms || 2000) / 1000))
    payment.value.wechatpay_v3.mchid = paymentStatus.value?.wechatpay_v3?.mchid || ''
    payment.value.wechatpay_v3.appid = paymentStatus.value?.wechatpay_v3?.appid || ''
    payment.value.wechatpay_v3.serial_no = paymentStatus.value?.wechatpay_v3?.serial_no || ''
    payment.value.wechatpay_v3.notify_url = paymentStatus.value?.wechatpay_v3?.notify_domain || ''

    payment.value.alipay_f2f.app_id = paymentStatus.value?.alipay_f2f?.app_id || ''
    payment.value.alipay_f2f.gateway = paymentStatus.value?.alipay_f2f?.gateway || payment.value.alipay_f2f.gateway
    payment.value.alipay_f2f.notify_url = paymentStatus.value?.alipay_f2f?.notify_domain || ''

    payment.value.unionpay.merchant_id = paymentStatus.value?.unionpay?.merchant_id || ''
    payment.value.unionpay.gateway = paymentStatus.value?.unionpay?.gateway || ''
    payment.value.unionpay.notify_url = paymentStatus.value?.unionpay?.notify_domain || ''
  } catch (e) {
    console.error(e)
  }
}

const savePaymentScope = async (scope) => {
  isSavingPayment.value = true
  try {
    const s = String(scope || '').trim()
    const payload = {}
    const pollMs = Math.max(1000, Math.floor(Number(pollIntervalSec.value || 0) * 1000))

    if (s === 'general' || s === 'all') {
      payload.poll_interval_ms = pollMs
    }

    if (s === 'wechat' || s === 'all') {
      payload.wechatpay_v3 = {
        mchid: payment.value.wechatpay_v3.mchid,
        appid: payment.value.wechatpay_v3.appid,
        serial_no: payment.value.wechatpay_v3.serial_no,
        notify_url: payment.value.wechatpay_v3.notify_url
      }
      if (payment.value.wechatpay_v3.api_v3_key.trim()) payload.wechatpay_v3.api_v3_key = payment.value.wechatpay_v3.api_v3_key.trim()
      if (payment.value.wechatpay_v3.merchant_private_key.trim()) payload.wechatpay_v3.merchant_private_key = payment.value.wechatpay_v3.merchant_private_key.trim()
      if (payment.value.wechatpay_v3.platform_cert.trim()) payload.wechatpay_v3.platform_cert = payment.value.wechatpay_v3.platform_cert.trim()
    }

    if (s === 'alipay' || s === 'all') {
      payload.alipay_f2f = {
        app_id: payment.value.alipay_f2f.app_id,
        gateway: payment.value.alipay_f2f.gateway,
        notify_url: payment.value.alipay_f2f.notify_url
      }
      if (payment.value.alipay_f2f.merchant_private_key.trim()) payload.alipay_f2f.merchant_private_key = payment.value.alipay_f2f.merchant_private_key.trim()
      if (payment.value.alipay_f2f.alipay_public_key.trim()) payload.alipay_f2f.alipay_public_key = payment.value.alipay_f2f.alipay_public_key.trim()
      if (payment.value.alipay_f2f.encrypt_key.trim()) payload.alipay_f2f.encrypt_key = payment.value.alipay_f2f.encrypt_key.trim()
    }

    if (s === 'unionpay' || s === 'all') {
      payload.unionpay = {
        merchant_id: payment.value.unionpay.merchant_id,
        gateway: payment.value.unionpay.gateway,
        notify_url: payment.value.unionpay.notify_url
      }
      if (payment.value.unionpay.sign_key.trim()) payload.unionpay.sign_key = payment.value.unionpay.sign_key.trim()
      if (payment.value.unionpay.sign_cert.trim()) payload.unionpay.sign_cert = payment.value.unionpay.sign_cert.trim()
      if (payment.value.unionpay.verify_cert.trim()) payload.unionpay.verify_cert = payment.value.unionpay.verify_cert.trim()
    }

    const res = await updatePayments(payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('支付配置已保存', 'success')
      if (s === 'wechat' || s === 'all') {
        payment.value.wechatpay_v3.api_v3_key = ''
        payment.value.wechatpay_v3.merchant_private_key = ''
        payment.value.wechatpay_v3.platform_cert = ''
      }
      if (s === 'alipay' || s === 'all') {
        payment.value.alipay_f2f.merchant_private_key = ''
        payment.value.alipay_f2f.alipay_public_key = ''
        payment.value.alipay_f2f.encrypt_key = ''
      }
      if (s === 'unionpay' || s === 'all') {
        payment.value.unionpay.sign_key = ''
        payment.value.unionpay.sign_cert = ''
        payment.value.unionpay.verify_cert = ''
      }
      await fetchPaymentSettings()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('保存失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('保存失败，网络错误', 'error')
  } finally {
    isSavingPayment.value = false
  }
}

const savePaymentSettings = async () => {
  await savePaymentScope('all')
}

const uploadTextFile = (file, cb) => {
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => cb(String(reader.result || ''))
  reader.readAsText(file)
}

const onUploadWeChatMerchantKey = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.wechatpay_v3.merchant_private_key = txt })
const onUploadWeChatPlatformCert = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.wechatpay_v3.platform_cert = txt })
const onUploadAlipayMerchantKey = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.alipay_f2f.merchant_private_key = txt })
const onUploadAlipayPublicKey = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.alipay_f2f.alipay_public_key = txt })
const onUploadUnionpaySignCert = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.unionpay.sign_cert = txt })
const onUploadUnionpayVerifyCert = (e) => uploadTextFile(e?.target?.files?.[0], (txt) => { payment.value.unionpay.verify_cert = txt })

const saveBasicSettings = async () => {
  if (isSavingBasic.value) return
  isSavingBasic.value = true
  try {
    const payload = { store_name: storeName.value.trim() }
    const res = await updateBasicSettings(payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('基础设置已保存', 'success')
      globalStoreName.value = payload.store_name // 同步全局状态
      await fetchSettings()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('保存失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('保存失败，网络错误', 'error')
  } finally {
    isSavingBasic.value = false
  }
}

const handleMigrateData = async () => {
  if (isMigratingData.value) return
  isMigratingData.value = true
  try {
    const resSelect = await selectDataDir().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (!resSelect.ok) throw new Error('选择目录失败')
    
    const selectData = await resSelect.json()
    const targetPath = selectData?.data?.path
    if (!targetPath) {
      isMigratingData.value = false
      return // User canceled dialog
    }

    if (targetPath === currentDataDir.value) {
      window.$toast('新目录与当前目录相同', 'warning')
      isMigratingData.value = false
      return
    }

    if (!confirm(`确定要将所有数据（数据库、图片、日志）迁移到:\n${targetPath}\n\n迁移完成后系统将自动重启！`)) {
      isMigratingData.value = false
      return
    }

    window.$toast('正在迁移数据并准备重启...', 'info')
    const resMigrate = await migrateDataDir({ new_dir: targetPath }).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    
    if (resMigrate.ok) {
      window.$toast('迁移成功，应用即将重启', 'success')
      // No need to set isMigratingData to false as the app will close
    } else {
      const data = await resMigrate.json().catch(() => ({}))
      window.$toast('迁移失败: ' + (data.error || '未知错误'), 'error')
      isMigratingData.value = false
    }
  } catch (e) {
    console.error(e)
    window.$toast('操作失败: ' + (e.message || '网络错误'), 'error')
    isMigratingData.value = false
  }
}

const saveNetworkSettings = async () => {
  if (isSavingNetwork.value) return
  isSavingNetwork.value = true
  try {
    const payload = { remote_access: networkConfig.value.remote_access }
    const res = await updateNetworkConfig(payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    
    if (res.ok) {
      window.$toast('网络设置已保存，系统即将重启', 'success')
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('保存失败: ' + (data.error || '未知错误'), 'error')
      isSavingNetwork.value = false
    }
  } catch (e) {
    console.error(e)
    window.$toast('操作失败: ' + (e.message || '网络错误'), 'error')
    isSavingNetwork.value = false
  }
}

const saveSettings = async () => {
  isSaving.value = true
  try {
    const payload = { provider: provider.value }
    if (tanshuapiKey.value.trim()) payload.tanshuapi_key = tanshuapiKey.value.trim()
    const res = await updateBarcodeLookup(payload).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      window.$toast('配置已保存', 'success')
      tanshuapiKey.value = ''
      await fetchSettings()
    } else {
      const data = await res.json().catch(() => ({}))
      window.$toast('保存失败: ' + (data.error || '未知错误'), 'error')
    }
  } catch (e) {
    console.error(e)
    window.$toast('保存失败，网络错误', 'error')
  } finally {
    isSaving.value = false
  }
}

const runTest = async () => {
  const code = testBarcode.value.trim()
  if (!code) {
    window.$toast('请输入条码', 'warning')
    return
  }
  isTesting.value = true
  testResult.value = null
  try {
    const res = await lookupBarcode(code).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))
    if (res.ok) {
      const json = await res.json()
      testResult.value = { ok: true, data: json.data }
      window.$toast('识别成功', 'success')
    } else {
      const data = await res.json().catch(() => ({}))
      testResult.value = { ok: false, error: data.error || '未识别到条码信息' }
      window.$toast(testResult.value.error, res.status === 404 ? 'warning' : 'error')
    }
  } catch (e) {
    console.error(e)
    testResult.value = { ok: false, error: '网络错误' }
    window.$toast('网络错误', 'error')
  } finally {
    isTesting.value = false
  }
}

onMounted(() => {
  fetchSettings()
  fetchPaymentSettings()
})
</script>

<template>
  <div class="settings-container">
    <div class="header-bar">
      <div class="title-wrap">
        <div class="title">系统设置</div>
        <div class="subtitle">条码识别、第三方接口等</div>
      </div>
      <div class="tabs-nav">
        <button :class="['tab-btn', { active: currentTab === 'basic' }]" @click="currentTab = 'basic'">基础设置</button>
        <button :class="['tab-btn', { active: currentTab === 'payment' }]" @click="currentTab = 'payment'">支付配置</button>
      </div>
    </div>

    <!-- 基础设置 -->
    <div class="grid" v-if="currentTab === 'basic'">
      <section class="card" v-if="isElectron">
        <div class="card-head">
          <div class="card-title">网络与局域网访问</div>
        </div>
        <div class="form">
          <div class="form-group" style="flex-direction: row; align-items: center; gap: 10px; margin-bottom: 8px;">
            <input type="checkbox" id="remoteAccessToggle" v-model="networkConfig.remote_access" style="width: 18px; height: 18px; cursor: pointer;" />
            <label for="remoteAccessToggle" style="margin-bottom: 0; cursor: pointer;">允许局域网设备（如手机、平板）访问收银台</label>
          </div>
          <div class="form-group" v-if="networkConfig.remote_access" style="margin-top: 12px;">
            <div class="data-dir-display" style="background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; padding: 12px 16px;">
              <div style="font-weight: bold; margin-bottom: 4px; font-size: 14px;">📡 局域网访问地址：</div>
              <div style="font-size: 16px; user-select: all;">http://{{ networkConfig.local_ip }}:{{ networkConfig.port }}</div>
              <div style="font-size: 12px; opacity: 0.8; margin-top: 8px; line-height: 1.5;">
                请确保您的移动设备与收银机连接在同一个局域网内（如同一个 WiFi），然后在设备的浏览器中输入上述地址即可访问。如果无法打开，请检查 Windows 防火墙是否放行了该端口。
              </div>
            </div>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" @click="saveNetworkSettings" :disabled="isSavingNetwork">
              {{ isSavingNetwork ? '保存中...' : '保存网络设置' }}
            </button>
            <div class="hint" style="margin-left: 12px; font-size: 13px; color: var(--text-muted);">
              修改此项配置后，系统将会自动重启。
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">门店信息</div>
        </div>
        <div class="form">
          <div class="form-group">
            <label>门店名称</label>
            <input v-model="storeName" class="form-input" placeholder="输入您的门店名称，将显示在订单和部分票据上" />
          </div>
          <div class="actions">
            <button class="btn btn-primary" @click="saveBasicSettings" :disabled="isSavingBasic">
              {{ isSavingBasic ? '保存中...' : '保存基础设置' }}
            </button>
          </div>
        </div>
      </section>

      <section class="card" v-if="isElectron">
        <div class="card-head">
          <div class="card-title">数据存储位置</div>
        </div>
        <div class="form">
          <div class="form-group">
            <label>当前数据目录（包含数据库及图片文件）</label>
            <div class="data-dir-display">{{ currentDataDir }}</div>
          </div>
          <div class="actions">
            <button class="btn btn-secondary" @click="handleMigrateData" :disabled="isMigratingData">
              {{ isMigratingData ? '迁移中...' : '迁移数据目录' }}
            </button>
            <div class="hint" style="margin-left: 12px; font-size: 13px; color: var(--text-muted);">
              选择新目录后，系统将自动把所有数据文件复制过去并重启应用。
            </div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">条码识别（中国）</div>
          <div class="badge" :class="tanshuapiKeySet ? 'ok' : 'warn'">{{ tanshuapiKeySet ? '已配置' : '未配置' }}</div>
        </div>

        <div class="form">
          <div class="form-group">
            <label>平台</label>
            <select v-model="provider" class="form-select">
              <option value="tanshuapi">探数API - 商品条码查询</option>
            </select>
          </div>

          <div class="form-group">
            <label>Key <span class="hint">不回显，留空则不修改</span></label>
            <input v-model="tanshuapiKey" type="password" class="form-input" placeholder="输入探数API key" />
          </div>

          <div class="actions">
            <button class="btn btn-primary" @click="saveSettings" :disabled="isSaving">
              {{ isSaving ? '保存中...' : '保存配置' }}
            </button>
          </div>

          <div class="note">
            <div class="note-title">接口说明</div>
            <div class="note-text">探数API接口：api.tanshuapi.com /api/barcode/v1/index</div>
            <div class="note-text">图片字段有效期24小时；需要长期保存建议上传图片或下载后再上传。</div>
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title">识别测试</div>
        </div>

        <div class="form">
          <div class="form-group">
            <label>条码</label>
            <div class="row">
              <input v-model="testBarcode" class="form-input" placeholder="输入或扫码条码，如 6906337301091" @keyup.enter="runTest" />
              <button class="btn btn-secondary" @click="runTest" :disabled="isTesting">
                {{ isTesting ? '测试中...' : '测试识别' }}
              </button>
            </div>
          </div>

          <div v-if="testResult" class="result">
            <div v-if="testResult.ok" class="result-ok">
              <div class="r-title">识别结果</div>
              <div class="r-kv">
                <div class="k">来源</div>
                <div class="v">{{ testResult.data.source }}</div>
              </div>
              <div class="r-kv">
                <div class="k">名称</div>
                <div class="v">{{ testResult.data.name }}</div>
              </div>
              <div v-if="testResult.data.image_url" class="r-img">
                <img :src="testResult.data.image_url" alt="图片" />
              </div>
            </div>
            <div v-else class="result-err">
              <div class="r-title">识别失败</div>
              <div class="r-msg">{{ testResult.error }}</div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 支付设置 -->
    <div v-if="currentTab === 'payment'">
      <div class="subtabs-nav">
        <button :class="['subtab-btn', { active: paymentTab === 'alipay' }]" @click="paymentTab = 'alipay'">支付宝</button>
        <button :class="['subtab-btn', { active: paymentTab === 'wechat' }]" @click="paymentTab = 'wechat'">微信支付 (开发中)</button>
        <button :class="['subtab-btn', { active: paymentTab === 'unionpay' }]" @click="paymentTab = 'unionpay'">云闪付 (开发中)</button>
        <button :class="['subtab-btn', { active: paymentTab === 'general' }]" @click="paymentTab = 'general'">通用</button>
      </div>

      <div class="grid" v-if="paymentTab === 'wechat'">
      <section class="card">
        <div class="card-head">
          <div class="card-title">微信支付 V3 (功能开发中，暂时不可用)</div>
          <div class="badge" :class="paymentStatus?.wechatpay_v3?.api_v3_key_set && paymentStatus?.wechatpay_v3?.merchant_private_key_set ? 'ok' : 'warn'">
            {{ paymentStatus?.wechatpay_v3?.api_v3_key_set && paymentStatus?.wechatpay_v3?.merchant_private_key_set ? '已配置' : '未完整配置' }}
          </div>
        </div>

        <div class="form">
          <div class="form-row">
            <div class="form-group col">
              <label>商户号 mchid</label>
              <input v-model="payment.wechatpay_v3.mchid" class="form-input" placeholder="如：1900000109" />
            </div>
            <div class="form-group col">
              <label>AppID appid</label>
              <input v-model="payment.wechatpay_v3.appid" class="form-input" placeholder="如：wx8888888888888888" />
            </div>
          </div>

          <div class="form-group">
            <label>证书序列号 serial_no</label>
            <input v-model="payment.wechatpay_v3.serial_no" class="form-input" placeholder="商户证书序列号" />
          </div>

          <div class="form-group">
            <label>APIv3Key <span class="hint">{{ paymentStatus?.wechatpay_v3?.api_v3_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <input v-model="payment.wechatpay_v3.api_v3_key" type="password" class="form-input" placeholder="留空不修改" />
          </div>

          <div class="form-group">
            <label>商户私钥（PEM） <span class="hint">{{ paymentStatus?.wechatpay_v3?.merchant_private_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.wechatpay_v3.merchant_private_key" class="form-textarea" rows="6" placeholder="粘贴商户API私钥 PEM，或上传文件（留空不修改）"></textarea>
            <label class="upload-btn">
              上传私钥
              <input type="file" accept=".pem,.key,.txt" @change="onUploadWeChatMerchantKey" />
            </label>
          </div>

          <div class="form-group">
            <label>平台证书（PEM，用于回调验签） <span class="hint">{{ paymentStatus?.wechatpay_v3?.platform_cert_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.wechatpay_v3.platform_cert" class="form-textarea" rows="6" placeholder="粘贴微信支付平台证书 PEM，或上传文件（留空不修改）"></textarea>
            <label class="upload-btn">
              上传平台证书
              <input type="file" accept=".pem,.crt,.cer,.txt" @change="onUploadWeChatPlatformCert" />
            </label>
          </div>

          <div class="form-group">
            <label>回调域名（可选） <span class="hint">{{ paymentStatus?.wechatpay_v3?.notify_mode === 'callback' ? '回调' : '轮询' }}</span></label>
            <input v-model="payment.wechatpay_v3.notify_url" class="form-input" placeholder="如：https://pay.example.com（仅域名，自动拼接回调路径；留空则轮询）" />
          </div>
          <div class="actions">
            <button class="btn btn-primary" @click="savePaymentScope('wechat')" :disabled="isSavingPayment">
              {{ isSavingPayment ? '保存中...' : '保存微信配置' }}
            </button>
          </div>
        </div>
      </section>
      </div>

      <div class="grid" v-else-if="paymentTab === 'alipay'">
      <section class="card">
        <div class="card-head">
          <div class="card-title">支付宝当面付</div>
          <div class="badge" :class="paymentStatus?.alipay_f2f?.merchant_private_key_set && paymentStatus?.alipay_f2f?.alipay_public_key_set ? 'ok' : 'warn'">
            {{ paymentStatus?.alipay_f2f?.merchant_private_key_set && paymentStatus?.alipay_f2f?.alipay_public_key_set ? '已配置' : '未完整配置' }}
          </div>
        </div>

        <div class="form">
          <div class="form-group">
            <label>AppID</label>
            <input v-model="payment.alipay_f2f.app_id" class="form-input" placeholder="支付宝应用 app_id" />
          </div>
          <div class="form-group">
            <label>Gateway</label>
            <input v-model="payment.alipay_f2f.gateway" class="form-input" placeholder="沙箱/正式网关" />
          </div>
          <div class="form-group">
            <label>AES 密钥（可选） <span class="hint">{{ paymentStatus?.alipay_f2f?.encrypt_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <input v-model="payment.alipay_f2f.encrypt_key" type="password" class="form-input" placeholder="内容加密密钥（base64，留空不修改）" />
          </div>
          <div class="form-group">
            <label>应用私钥（PEM） <span class="hint">{{ paymentStatus?.alipay_f2f?.merchant_private_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.alipay_f2f.merchant_private_key" class="form-textarea" rows="6" placeholder="支持两种格式：1）完整PEM(含BEGIN/END)；2）仅base64私钥内容(不含头尾)。留空不修改"></textarea>
            <label class="upload-btn">
              上传应用私钥
              <input type="file" accept=".pem,.key,.txt" @change="onUploadAlipayMerchantKey" />
            </label>
          </div>
          <div class="form-group">
            <label>支付宝公钥（PEM） <span class="hint">{{ paymentStatus?.alipay_f2f?.alipay_public_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.alipay_f2f.alipay_public_key" class="form-textarea" rows="6" placeholder="粘贴支付宝公钥 PEM，或上传文件（留空不修改）"></textarea>
            <label class="upload-btn">
              上传支付宝公钥
              <input type="file" accept=".pem,.crt,.cer,.txt" @change="onUploadAlipayPublicKey" />
            </label>
          </div>
          <div class="form-group">
            <label>回调域名（可选） <span class="hint">{{ paymentStatus?.alipay_f2f?.notify_mode === 'callback' ? '回调' : '轮询' }}</span></label>
            <input v-model="payment.alipay_f2f.notify_url" class="form-input" placeholder="如：https://pay.example.com（仅域名，自动拼接回调路径；留空则轮询）" />
          </div>
          <div class="actions">
            <button class="btn btn-primary" @click="savePaymentScope('alipay')" :disabled="isSavingPayment">
              {{ isSavingPayment ? '保存中...' : '保存支付宝配置' }}
            </button>
          </div>
        </div>
      </section>
      </div>

      <div class="grid" v-if="paymentTab === 'unionpay'">
        <section class="card">
          <div class="card-head">
            <div class="card-title">云闪付 (功能开发中，暂时不可用)</div>
            <div class="badge" :class="paymentStatus?.unionpay?.sign_key_set ? 'ok' : 'warn'">
            {{ paymentStatus?.unionpay?.sign_key_set ? '已配置(部分)' : '未配置' }}
          </div>
        </div>

        <div class="form">
          <div class="form-row">
            <div class="form-group col">
              <label>商户号</label>
              <input v-model="payment.unionpay.merchant_id" class="form-input" placeholder="银联商户号" />
            </div>
            <div class="form-group col">
              <label>Gateway</label>
              <input v-model="payment.unionpay.gateway" class="form-input" placeholder="银联网关地址(按你签约文档)" />
            </div>
          </div>
          <div class="form-group">
            <label>签名密钥/证书密码 <span class="hint">{{ paymentStatus?.unionpay?.sign_key_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <input v-model="payment.unionpay.sign_key" type="password" class="form-input" placeholder="留空不修改" />
          </div>
          <div class="form-group">
            <label>签名证书（PEM/PFX转PEM） <span class="hint">{{ paymentStatus?.unionpay?.sign_cert_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.unionpay.sign_cert" class="form-textarea" rows="6" placeholder="粘贴签名证书文本（留空不修改）"></textarea>
            <label class="upload-btn">
              上传签名证书
              <input type="file" accept=".pem,.crt,.cer,.txt" @change="onUploadUnionpaySignCert" />
            </label>
          </div>
          <div class="form-group">
            <label>验签证书（PEM） <span class="hint">{{ paymentStatus?.unionpay?.verify_cert_set ? '已配置(不回显)' : '未配置' }}</span></label>
            <textarea v-model="payment.unionpay.verify_cert" class="form-textarea" rows="6" placeholder="粘贴验签证书文本（留空不修改）"></textarea>
            <label class="upload-btn">
              上传验签证书
              <input type="file" accept=".pem,.crt,.cer,.txt" @change="onUploadUnionpayVerifyCert" />
            </label>
          </div>
          <div class="form-group">
            <label>回调域名（可选） <span class="hint">{{ paymentStatus?.unionpay?.notify_mode === 'callback' ? '回调' : '轮询' }}</span></label>
            <input v-model="payment.unionpay.notify_url" class="form-input" placeholder="如：https://pay.example.com（仅域名，自动拼接回调路径；留空则轮询）" />
          </div>
          <div class="actions">
            <button class="btn btn-primary" @click="savePaymentScope('unionpay')" :disabled="isSavingPayment">
              {{ isSavingPayment ? '保存中...' : '保存云闪付配置' }}
            </button>
          </div>
        </div>
      </section>
      </div>

      <div class="grid" v-else>
        <section class="card">
          <div class="card-head">
            <div class="card-title">通用设置</div>
          </div>
          <div class="form">
            <div class="form-group">
              <label>支付结果轮询间隔（秒） <span class="hint">不得小于 1 秒</span></label>
              <input v-model.number="pollIntervalSec" type="number" min="1" step="1" class="form-input" placeholder="默认 2 秒" />
            </div>
            <div class="note">
              <div class="note-title">安全提示</div>
              <div class="note-text">配置项以“不回显”的方式保存，页面只显示是否已配置。</div>
              <div class="note-text">建议在生产环境优先用环境变量注入，避免在前端页面输入敏感信息。</div>
            </div>
            <div class="actions">
              <button class="btn btn-primary" @click="savePaymentScope('general')" :disabled="isSavingPayment">
                {{ isSavingPayment ? '保存中...' : '保存通用配置' }}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  padding: 20px;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.header-bar {
  padding: 18px 22px;
  background: var(--surface);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.title {
  font-size: 20px;
  font-weight: 800;
  color: var(--text-main);
}

.subtitle {
  margin-top: 6px;
  font-size: 14px;
  color: var(--text-light);
}

.tabs-nav {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 0;
}

.tab-btn {
  padding: 10px 16px;
  border: none;
  background: none;
  font-size: 15px;
  font-weight: 500;
  color: var(--text-light);
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
}

.tab-btn:hover {
  color: var(--primary);
}

.tab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.subtabs-nav {
  display: flex;
  gap: 10px;
  margin-top: 14px;
  border-bottom: 1px solid var(--border-color);
}

.subtab-btn {
  padding: 10px 14px;
  border: none;
  background: none;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-light);
  cursor: pointer;
  border-bottom: 3px solid transparent;
  transition: all 0.2s;
}

.subtab-btn:hover {
  color: var(--primary);
}

.subtab-btn.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  align-items: start;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  padding: 18px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.card-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-main);
}

.badge {
  font-size: 12px;
  font-weight: 800;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
}

.badge.ok {
  color: #047857;
  background: var(--success-bg);
  border-color: rgba(16, 185, 129, 0.3);
}

.badge.warn {
  color: #b45309;
  background: var(--warning-bg);
  border-color: rgba(245, 158, 11, 0.35);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-main);
  margin-bottom: 8px;
}

.hint {
  font-weight: 600;
  color: var(--text-muted);
  font-size: 12px;
}

.form-input, .form-select {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--surface);
  font-size: 14px;
  outline: none;
}

.form-textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--surface);
  font-size: 13px;
  outline: none;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.form-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.form-input:focus, .form-select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light);
}

.row {
  display: flex;
  gap: 10px;
}

.form-row {
  display: flex;
  gap: 12px;
}
.form-row .col {
  flex: 1;
}

.row .form-input {
  flex: 1;
}

.actions {
  display: flex;
  justify-content: flex-end;
}

.note {
  margin-top: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
}

.note-title {
  font-size: 12px;
  font-weight: 900;
  color: var(--text-main);
  margin-bottom: 6px;
}

.note-text {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.5;
}

.result {
  border-top: 1px solid var(--border-color);
  padding-top: 14px;
}

.r-title {
  font-size: 13px;
  font-weight: 900;
  color: var(--text-main);
  margin-bottom: 10px;
}

.r-kv {
  display: grid;
  grid-template-columns: 64px 1fr;
  gap: 10px;
  margin-bottom: 8px;
  font-size: 13px;
}

.r-kv .k {
  color: var(--text-muted);
  font-weight: 700;
}

.r-kv .v {
  color: var(--text-main);
  font-weight: 700;
}

.r-img img {
  margin-top: 10px;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: #fff;
}

.result-err .r-msg {
  font-size: 13px;
  font-weight: 700;
  color: var(--danger);
  background: var(--danger-bg);
  border: 1px solid rgba(239, 68, 68, 0.35);
  padding: 12px 14px;
  border-radius: 14px;
}

.data-dir-display {
  background: var(--surface-alt);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-color);
  font-family: monospace;
  font-size: 13px;
  color: var(--text-main);
  word-break: break-all;
}

@media (max-width: 900px) {
  .settings-container {
    padding-top: 76px;
    padding-bottom: 92px;
  }
  .grid {
    grid-template-columns: 1fr;
  }
  .row {
    flex-direction: column;
  }
  .actions {
    justify-content: stretch;
  }
  .actions .btn {
    width: 100%;
  }
}
</style>
