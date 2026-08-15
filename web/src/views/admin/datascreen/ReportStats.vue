<template>
  <PlanPlaceholder
    icon="DataAnalysis"
    title="报工统计"
    desc="按工序 / 日期 / 人员汇总良品与废品数量"
    :features="[
      { icon: 'Calendar', title: '按日汇总', desc: '每日报工良品、废品数量与工时统计' },
      { icon: 'Files', title: '按工序汇总', desc: '各工序累计产量、一次合格率对比' },
      { icon: 'User', title: '按报工人汇总', desc: '每位报工人的产量贡献排行' },
    ]"
  />
</template>

<script setup>
import PlanPlaceholder from './PlanPlaceholder.vue'
</script>
