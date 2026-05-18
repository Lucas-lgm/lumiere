import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'library',
      component: () => import('./views/MainView.vue')
    },
    {
      path: '/player',
      name: 'player',
      component: () => import('./views/VideoView.vue')
    },
    {
      path: '/control',
      name: 'control',
      component: () => import('./views/ControlView.vue')
    }
  ]
})

export default router
