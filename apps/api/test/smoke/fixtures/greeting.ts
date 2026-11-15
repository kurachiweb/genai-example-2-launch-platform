import { ContainerModule, inject, injectable } from 'inversify';

export const SMOKE_TYPES = Object.freeze({
  Greeting: Symbol.for('smoke.Greeting'),
  Salutation: Symbol.for('smoke.Salutation'),
  Recipient: Symbol.for('smoke.Recipient'),
});

@injectable()
export class Greeting {
  constructor(
    @inject(SMOKE_TYPES.Salutation) private readonly salutation: string,
    @inject(SMOKE_TYPES.Recipient) private readonly recipient: string,
  ) {}

  message(): string {
    return `${this.salutation}、${this.recipient}`;
  }
}

export const greetingModule = new ContainerModule(({ bind }) => {
  bind<string>(SMOKE_TYPES.Salutation).toConstantValue('こんにちは');
  bind<string>(SMOKE_TYPES.Recipient).toConstantValue('Inversify');
  bind<Greeting>(SMOKE_TYPES.Greeting).to(Greeting);
});
