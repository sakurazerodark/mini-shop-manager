const fs = require('fs');
let content = fs.readFileSync('src/views/InventoryManager.vue', 'utf8');

// 1. Imports
content = content.replace(
  "import { getProducts, getProductByBarcode",
  "import { getProducts, getDeletedProducts, getProductByBarcode"
);
content = content.replace(
  "deleteProduct as apiDeleteProduct, productLoss",
  "deleteProduct as apiDeleteProduct, restoreProduct, productLoss"
);

// 2. Refs & Computed
content = content.replace(
  "const products = ref([])",
  "const products = ref([])\nconst deletedProducts = ref([])"
);
content = content.replace(
  "const viewMode = ref('list') // 'list' | 'add'",
  "const viewMode = ref('list') // 'list' | 'add' | 'deleted'"
);
content = content.replace(
  "const getUploadUrl = (url) => {",
  "const filteredDeletedProducts = computed(() => {\n  const query = searchQuery.value.trim().toLowerCase()\n  if (!query) return deletedProducts.value\n  return deletedProducts.value.filter(p => \n    (p.name && p.name.toLowerCase().includes(query)) || \n    (p.barcode && p.barcode.toLowerCase().includes(query))\n  )\n})\n\nconst getUploadUrl = (url) => {"
);

// 3. fetchDeletedProducts & handleRestoreProduct
content = content.replace(
  "const handleBarcodeEnter = () => {",
  "const fetchDeletedProducts = async () => {\n  try {\n    const res = await getDeletedProducts().then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))\n    const json = await res.json()\n    deletedProducts.value = json.data || []\n  } catch (error) {\n    console.error('获取已删除商品失败', error)\n  }\n}\n\nconst handleRestoreProduct = async (id) => {\n  try {\n    const res = await restoreProduct(id).then(data => ({ ok: true, json: () => Promise.resolve(data) })).catch(e => ({ ok: false, json: () => Promise.resolve(e) }))\n    if (res.ok) {\n      window.$toast('商品恢复成功', 'success')\n      fetchProducts()\n      fetchDeletedProducts()\n    } else {\n      const data = await res.json().catch(() => ({}))\n      window.$toast('恢复失败: ' + (data.error || '未知错误'), 'error')\n    }\n  } catch (error) {\n    console.error('恢复商品失败', error)\n    window.$toast('恢复失败，网络错误', 'error')\n  }\n}\n\nconst handleBarcodeEnter = () => {"
);

// 4. Update deleteProduct function
content = content.replace(
  "const deleteProduct = async (id) => {\n  const confirmed = await showConfirm('确定要彻底删除此商品吗？此操作不可恢复。')",
  "const deleteProduct = async (id) => {\n  const confirmed = await showConfirm('确定要删除此商品吗？删除后可在\"已删除\"列表中找回。')"
);
content = content.replace(
  "window.$toast('删除成功', 'success')\n      fetchProducts()",
  "window.$toast('已移至已删除列表', 'success')\n      fetchProducts()\n      fetchDeletedProducts()"
);

// 5. Add to onMounted
content = content.replace(
  "fetchProducts()\n  fetchSuppliers()",
  "fetchProducts()\n  fetchDeletedProducts()\n  fetchSuppliers()"
);

// 6. Update template header
content = content.replace(
  "<h2 class=\"page-title\">{{ viewMode === 'list' ? '商品与库存管理' : '新增商品' }}</h2>",
  "<h2 class=\"page-title\">{{ viewMode === 'list' ? '商品与库存管理' : (viewMode === 'deleted' ? '已删除商品' : '新增商品') }}</h2>"
);
content = content.replace(
  "v-if=\"viewMode === 'list'\">\n          <span class=\"icon\">+</span> 录入新商品",
  "v-if=\"viewMode === 'list' || viewMode === 'deleted'\">\n          <span class=\"icon\">+</span> 录入新商品"
);
content = content.replace(
  "v-if=\"viewMode === 'list'\">\n          <span class=\"icon\">🏢</span> 供应商管理",
  "v-if=\"viewMode === 'list' || viewMode === 'deleted'\">\n          <span class=\"icon\">🏢</span> 供应商管理"
);
content = content.replace(
  "v-if=\"viewMode === 'list'\">\n          <span class=\"icon\">⚙️</span> 条码设置",
  "v-if=\"viewMode === 'list' || viewMode === 'deleted'\">\n          <span class=\"icon\">⚙️</span> 条码设置"
);
content = content.replace(
  "<button v-else @click=\"viewMode = 'list'\" class=\"btn btn-secondary\">",
  "<button @click=\"viewMode = 'deleted'\" class=\"btn btn-secondary btn-danger-outline\" v-if=\"viewMode === 'list'\">\n          <span class=\"icon\">🗑️</span> 已删除\n        </button>\n        <button v-if=\"viewMode === 'add' || viewMode === 'deleted'\" @click=\"viewMode = 'list'\" class=\"btn btn-secondary\">"
);

// 7. Add deleted list view
const deletedViewStr = `      <!-- 视图：已删除列表 -->
      <div v-else-if="viewMode === 'deleted'" class="list-container">
        <div class="search-bar">
          <input type="text" v-model="searchQuery" placeholder="搜索已删除商品的条码或名称..." class="search-input" />
          <button class="btn btn-secondary search-btn">🔍</button>
        </div>
        <div class="table-wrapper">
          <table class="inventory-table">
            <thead>
              <tr>
                <th width="20%">商品编码</th>
                <th width="25%">商品名称</th>
                <th width="15%">价格(进/售)</th>
                <th width="15%">删除时间</th>
                <th width="25%">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredDeletedProducts" :key="p.id">
                <td class="code-cell">{{ p.barcode ? p.barcode.replace(/_deleted_\\d+$/, '') : '' }}</td>
                <td>
                  <div class="product-name">
                    <img v-if="p.image_url" :src="getUploadUrl(p.image_url)" class="thumb" alt="商品照片" />
                    <div style="display:flex;flex-direction:column;gap:4px;">
                      <span style="color: var(--text-muted); text-decoration: line-through;">{{ p.name }}</span>
                      <span style="font-size:12px;color:#9ca3af;">{{ p.brand ? p.brand + ' | ' : '' }}{{ getSupplierNames(p.supplier_ids) }}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <div class="price-stack" style="opacity: 0.6;">
                    <span class="cost-price">均 ¥{{ (p.cost_price||0).toFixed(2) }}</span>
                    <span class="retail-price">¥{{ (p.retail_price||0).toFixed(2) }}</span>
                  </div>
                </td>
                <td>
                  <span class="status-badge danger">
                    <span class="dot"></span>
                    {{ new Date(p.deleted_at).toLocaleDateString() }}
                  </span>
                </td>
                <td>
                  <div class="action-group">
                    <button class="btn btn-action" @click="handleRestoreProduct(p.id)" title="恢复商品">♻️ 恢复商品</button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredDeletedProducts.length === 0">
                <td colspan="5">
                  <div class="empty-state">
                    <div class="empty-icon">🗑️</div>
                    <div class="empty-text">回收站空空如也</div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
content = content.replace("</div>\n  </div>\n</template>", deletedViewStr + "\n</template>");

fs.writeFileSync('src/views/InventoryManager.vue', content);
