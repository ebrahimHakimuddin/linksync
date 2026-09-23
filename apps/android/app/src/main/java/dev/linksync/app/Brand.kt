package dev.linksync.app

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.widget.Button
import android.widget.CompoundButton
import android.widget.EditText
import android.widget.TextView

/** CrossLinks brand kit palette and component styling, shared by every screen. */
object Brand {
    private const val BLUE = 0xFF0077FF.toInt()
    private const val SKY = 0xFF00C6FF.toInt()

    private fun Context.night() = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    private fun Context.px(dp: Int) = (dp * resources.displayMetrics.density).toInt()

    fun accent(context: Context) = if (context.night()) 0xFF3D9BFF.toInt() else BLUE
    fun text(context: Context) = if (context.night()) 0xFFE2E8F0.toInt() else 0xFF0F172A.toInt()
    fun muted(context: Context) = if (context.night()) 0xFF94A3B8.toInt() else 0xFF64748B.toInt()
    fun danger(context: Context) = if (context.night()) 0xFFFB7185.toInt() else 0xFFE11D48.toInt()
    private fun surface(context: Context) = if (context.night()) 0xFF111A2E.toInt() else Color.WHITE
    private fun border(context: Context) = if (context.night()) 0xFF1E2A44.toInt() else 0xFFE2E8F0.toInt()

    fun card(context: Context, radiusDp: Int = 16) = GradientDrawable().apply {
        setColor(surface(context))
        setStroke(context.px(1), border(context))
        cornerRadius = context.px(radiusDp).toFloat()
    }

    fun primary(button: Button) = button.apply {
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(SKY, BLUE)).apply { cornerRadius = context.px(12).toFloat() }
        setTextColor(Color.WHITE)
        base()
    }

    fun secondary(button: Button) = button.apply {
        background = card(context, 12)
        setTextColor(text(context))
        base()
    }

    private fun Button.base() {
        isAllCaps = false
        stateListAnimator = null
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        textSize = 15f
        minHeight = context.px(50)
        setPadding(context.px(18), 0, context.px(18), 0)
    }

    fun input(field: EditText) = field.apply {
        background = card(context, 12)
        setTextColor(text(context))
        setHintTextColor(muted(context))
        setPadding(context.px(14), context.px(12), context.px(14), context.px(12))
    }

    fun tint(control: CompoundButton) = control.apply {
        buttonTintList = ColorStateList.valueOf(accent(context))
        setTextColor(text(context))
    }

    /** Lowercase bold wordmark, as in the brand kit. */
    fun wordmark(view: TextView) = view.apply {
        text = "crosslinks"
        textSize = 22f
        letterSpacing = -0.03f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        setTextColor(text(context))
    }
}
