<script setup lang="ts">
defineProps<{ open: boolean; title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="modal-mask" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true">
        <header class="modal-head">
          <h3>{{ title }}</h3>
          <button type="button" class="secondary" @click="emit('close')">×</button>
        </header>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
