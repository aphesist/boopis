import React from "react";

interface ButtonProps {
  label: string;
}

export function Button({ label }: ButtonProps) {
  return <button>{label}</button>;
}

export const Card = ({ label }: ButtonProps) => <div>{label}</div>;

export default class Page extends React.Component<ButtonProps> {
  render() {
    return <Button label={this.props.label} />;
  }
}
