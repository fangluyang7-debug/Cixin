export class RegisterDto {
  email: string;
  password: string;
  displayName?: string;
}

export class LoginDto {
  email: string;
  password: string;
}
