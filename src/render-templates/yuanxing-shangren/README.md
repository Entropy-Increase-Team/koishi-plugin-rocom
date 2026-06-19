# 远行商人模板说明

## 文件列表

### 当前使用版本
- **index.html** - "今日远行商人"版本（从 WeGame-plugin modules 搬运）
  - 特点：按轮次分组展示，显示"今日商品数"
  - 数据结构：需要 `total_products`、`categories` 中包含 `roundGroups`
  - 样式：内嵌在HTML中

### 备份版本
- **index.html.backup** - 之前创建的现代化设计版本
  - 特点：使用 WeGame-plugin 风格的现代化设计
  - 采用 Inter + Fraunces 字体，温暖的奶油色调
  - 编辑风格排版，卡片式布局

### 样式文件
- **style.css** - 原始旧版本的样式（传统中式风格）
- **today.style.css** - 从 today.html 提取的样式（供参考）

## 版本对比

| 版本 | 文件 | 风格 | 数据结构 |
|------|------|------|----------|
| 今日商人 | index.html | 传统土色调，按轮次分组 | 需要 `total_products`, `roundGroups` |
| 现代版 | index.html.backup | 现代化 WeGame 风格 | 原有的 `categories` 结构 |
| 旧版 | 仓库历史版本 | 传统中式风格 | 原有的 `categories` 结构 |

## 切换版本

如需切换回现代化版本：
```bash
cd src/render-templates/yuanxing-shangren
cp index.html.backup index.html
```

如需恢复到仓库原始版本：
```bash
git checkout HEAD -- index.html
```

## 数据结构差异

### 今日商人版本需要的数据
```javascript
{
  title: "今日远行商人",
  subtitle: "...",
  total_products: 10,
  categories: [
    {
      key: "round",
      label: "常规商品",
      product_count: 8,
      roundGroups: [
        {
          round_id: 1,
          label: "08:00-12:00",
          is_current: true,
          products: [...]
        }
      ]
    }
  ]
}
```

### 原版本数据结构
```javascript
{
  title: "远行商人",
  product_count: 10,
  round_info: { current: 1, total: 4, countdown: "3小时20分钟" },
  categories: [
    {
      key: "normal",
      label: "热销商品",
      products: [...]
    }
  ]
}
```

## 注意事项

使用 today.html 版本需要修改 merchant.ts 中的数据渲染逻辑，以匹配新的数据结构。
