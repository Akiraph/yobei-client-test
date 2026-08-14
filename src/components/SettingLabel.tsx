interface Props {
  name: string;
  desc: string;
}

export function SettingLabel(props: Props) {
  return (
    <div class="setting-label">
      <div class="setting-name">{props.name}</div>
      <div class="setting-desc">{props.desc}</div>
    </div>
  );
}
