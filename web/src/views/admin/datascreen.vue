<template>
  <section class="data-page">
    <!-- 规划说明卡片 -->
    <div class="glass-card">
      <div class="hero-icon">
        <el-icon :size="30"><DataAnalysis /></el-icon>
      </div>
      <span class="pill">规划中</span>
      <h2 class="card-title">数据大屏</h2>
      <p class="card-desc">车间生产数据可视化看板，建设中，敬请期待</p>
    </div>

    <!-- 预告能力 -->
    <div class="preview-panel">
      <div class="list-head">上线后你将看到</div>
      <div class="preview-cell">
        <div class="pv-ico"><el-icon :size="16"><Document /></el-icon></div>
        <div class="pv-main">
          <div class="pv-title">报工统计</div>
          <div class="pv-desc">按工序/日期汇总良品与废品数量</div>
        </div>
      </div>
      <div class="preview-cell">
        <div class="pv-ico"><el-icon :size="16"><List /></el-icon></div>
        <div class="pv-main">
          <div class="pv-title">加工单进度</div>
          <div class="pv-desc">每张加工单各工序完成进度一览</div>
        </div>
      </div>
      <div class="preview-cell">
        <div class="pv-ico"><el-icon :size="16"><TrendCharts /></el-icon></div>
        <div class="pv-main">
          <div class="pv-title">工序产出趋势</div>
          <div class="pv-desc">实时更新的产量与工时趋势图</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.data-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ===== 规划卡片 ===== */
.glass-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 24px 36px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 20px;
  text-align: center;
}

.hero-icon {
  width: 64px;
  height: 64px;
  border-radius: 20px;
  background: var(--primary-soft, rgba(0, 122, 255, 0.12));
  color: var(--primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.pill {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  line-height: 1.6;
}

.card-title {
  margin: 4px 0 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--foreground);
}

.card-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--muted-foreground);
}

/* ===== 预告列表（iOS 分组列表） ===== */
.preview-panel {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
}

.list-head {
  padding: 12px 16px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--muted-foreground);
}

.preview-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.pv-ico {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--muted, rgba(128, 128, 128, 0.1));
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pv-main {
  min-width: 0;
}

.pv-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--foreground);
}

.pv-desc {
  margin-top: 2px;
  font-size: 12px;
  color: var(--muted-foreground);
}
</style>
