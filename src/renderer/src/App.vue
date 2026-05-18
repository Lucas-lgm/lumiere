<template>
  <div id="app">
    <router-view />
    <ContextMenu />
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { useTheme } from './composables/useTheme'
import ContextMenu from './components/base/ContextMenu.vue'
import ToastContainer from './components/base/ToastContainer.vue'

// Initialize theme system — sets data-theme on <html>, persists to localStorage
useTheme()
</script>

<style>
* {
  user-select: none;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

#app {
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
