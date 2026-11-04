export interface AuthUser {
  id: string
  email: string
  username: string
  name: string
  role: 'ADMIN' | 'CUSTOMER'
}
