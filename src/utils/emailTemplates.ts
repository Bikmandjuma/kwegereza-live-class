function baseLayout(bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; background:#f6f4ee; padding:32px 16px;">
      <div style="max-width:480px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e7e2d5;">
        <div style="background:#0b3d2e; padding:20px 28px;">
          <span style="color:#cf9d3f; font-weight:800; font-size:18px; letter-spacing:.02em;">Kwegereza</span>
        </div>
        <div style="padding:28px;">
          ${bodyHtml}
        </div>
        <div style="padding:16px 28px; background:#f6f4ee; font-size:11px; color:#8a8371;">
          Kwegereza urubuga rw'uburezi bwa Islamu.
        </div>
      </div>
    </div>
  `;
}

export function approvalEmail(fullName: string, email: string, phone: string | null, loginUrl: string) {
  return {
    subject: "Urakaza neza muri Kwegereza Islam Umuryango!",
    html: baseLayout(`
      <h2 style="color:#0b3d2e; margin:0 0 12px;">Urakaza neza, ${fullName}!</h2>
      <p style="color:#33463c; line-height:1.6; margin:0 0 16px;">
        Ubuyobozi bwa Kwegereza Islam Umuryango bwemeje ko wiga. Ubu ushobora kwinjira ukoreshe
        urubuga byuzuye amasomo, ibitabo, ibizamini, n'ibindi byose.
      </p>
      <div style="background:#f6f4ee; border:1px solid #e7e2d5; border-radius:12px; padding:16px 20px; margin:0 0 20px;">
        <p style="color:#33463c; font-weight:700; margin:0 0 8px; font-size:13px;">Uko winjira (login):</p>
        <p style="color:#33463c; margin:0 0 4px; font-size:13px;"><b>Email:</b> ${email}</p>
        ${
          phone
            ? `<p style="color:#33463c; margin:0; font-size:13px;"><b>Ijambo ry'ibanga (password):</b> ${phone} (nimero zawe za WhatsApp wanditse)</p>`
            : ""
        }
      </div>
      <a href="${loginUrl}" style="display:inline-block; background:#cf9d3f; color:#1a1206; font-weight:700; padding:12px 24px; border-radius:999px; text-decoration:none;">
        Injira kuri Kwegereza
      </a>
    `),
  };
}

export function liveClassEmail(classTitle: string, hostName: string, joinUrl: string) {
  return {
    subject: `Isomo riri live ubu ${classTitle}`,
    html: baseLayout(`
      <h2 style="color:#0b3d2e; margin:0 0 12px;">Isomo ritangiye ubu!</h2>
      <p style="color:#33463c; line-height:1.6; margin:0 0 20px;">
        <b>${classTitle}</b> ryatangijwe na ${hostName}, kandi riri live ubu kuri Kwegereza.
      </p>
      <a href="${joinUrl}" style="display:inline-block; background:#0b3d2e; color:#ffffff; font-weight:700; padding:12px 24px; border-radius:999px; text-decoration:none;">
        Injira mu isomo ubu
      </a>
    `),
  };
}
