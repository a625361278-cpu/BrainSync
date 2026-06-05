<template>
  <slot />
</template>

<style>
page {
  color: #1f2329;
  background: #dfeff7;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}

button {
  margin: 0;
  padding: 0;
  border-radius: 8px;
  line-height: 1.2;
  font-family: inherit;
}

button::after {
  border: 0;
}

input {
  font-family: inherit;
}

.ghost-button {
  color: #1f2329;
  background: transparent;
}

.primary-pill {
  min-height: 44px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  color: #0ca257;
  background: #fff;
  box-shadow: inset 0 -4px 0 rgba(0, 0, 0, 0.08), 0 5px 12px rgba(4, 80, 47, 0.18);
  font-size: 18px;
  font-weight: 900;
}

.green-button {
  min-height: 42px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #fff;
  background: #07c160;
  font-weight: 800;
}

.green-button[disabled],
.primary-pill[disabled] {
  opacity: 0.55;
  background: #a8d9bf;
  color: #fff;
}
</style>
