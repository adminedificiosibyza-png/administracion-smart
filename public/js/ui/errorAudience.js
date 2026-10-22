/* Quién está usando el sistema, para decidir cuánto detalle técnico puede ver en un mensaje de error.
 * El administrador (superadmin) ve el detalle; propietarios e inquilinos nunca ven textos técnicos. */
let adminAudience = false;

export const setErrorAudience = (isAdmin) => { adminAudience = !!isAdmin; };
export const isAdminAudience = () => adminAudience;
