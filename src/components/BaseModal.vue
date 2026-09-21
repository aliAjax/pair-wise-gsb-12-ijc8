<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
}>();

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true">
        <header class="modal-head">
          <div>
            <h3>{{ title }}</h3>
            <p v-if="subtitle" class="modal-sub">{{ subtitle }}</p>
          </div>
          <button type="button" class="icon-btn" aria-label="关闭" @click="emit('close')">×</button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
      </div>
    </div>
  </Teleport>
</template>
