Shader "JiuQuest/Anime Fighter"
{
    Properties
    {
        // Keep the glTFast names and gamma-space factor convention so imported
        // textures, cosmetic recoloring and texture transforms share one contract.
        baseColorFactor ("Base color factor (sRGB)", Vector) = (1,1,1,1)
        baseColorTexture ("Base color", 2D) = "white" {}
        [HideInInspector] baseColorTexture_ST ("Base color transform", Vector) = (1,1,0,0)
        [HideInInspector] baseColorTexture_Rotation ("Base color rotation", Vector) = (0,0,0,0)
        [HideInInspector] baseColorTexture_texCoord ("Base color UV channel", Float) = 0
        alphaCutoff ("Alpha cutoff", Range(0,1)) = 0.5
        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 2
        _DetailStrength ("Texture detail", Range(0,1)) = 1
        _DetailBaseColor ("Texture reference (sRGB)", Vector) = (1,1,1,1)
        _InkStrength ("Silhouette ink", Range(0,1)) = 0.52
        // Preserve imported surface metadata for cloning and future style changes.
        // Cel shading intentionally uses the geometric normal instead of pore maps.
        [HideInInspector] metallicFactor ("Source metallic", Float) = 0
        [HideInInspector] roughnessFactor ("Source roughness", Float) = 1
        [HideInInspector] metallicRoughnessTexture ("Source metallic roughness", 2D) = "white" {}
        [HideInInspector] metallicRoughnessTexture_ST ("Source MR transform", Vector) = (1,1,0,0)
        [HideInInspector] metallicRoughnessTexture_Rotation ("Source MR rotation", Vector) = (0,0,0,0)
        [HideInInspector] metallicRoughnessTexture_texCoord ("Source MR UV", Float) = 0
        [HideInInspector] normalTexture ("Source normal", 2D) = "bump" {}
        [HideInInspector] normalTexture_ST ("Source normal transform", Vector) = (1,1,0,0)
        [HideInInspector] normalTexture_Rotation ("Source normal rotation", Vector) = (0,0,0,0)
        [HideInInspector] normalTexture_texCoord ("Source normal UV", Float) = 0
        [HideInInspector] normalTexture_scale ("Source normal scale", Float) = 1
        [HideInInspector] occlusionTexture ("Source occlusion", 2D) = "white" {}
        [HideInInspector] occlusionTexture_ST ("Source AO transform", Vector) = (1,1,0,0)
        [HideInInspector] occlusionTexture_Rotation ("Source AO rotation", Vector) = (0,0,0,0)
        [HideInInspector] occlusionTexture_texCoord ("Source AO UV", Float) = 0
        [HideInInspector] occlusionTexture_strength ("Source AO strength", Float) = 1
        [HideInInspector] emissiveFactor ("Source emission", Vector) = (0,0,0,0)
        [HideInInspector] emissiveTexture ("Source emission texture", 2D) = "white" {}
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" "Queue"="Geometry" }

        HLSLINCLUDE
        #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
        #include "Packages/com.unity.render-pipelines.core/ShaderLibrary/Color.hlsl"

        TEXTURE2D(baseColorTexture);
        SAMPLER(sampler_baseColorTexture);
        CBUFFER_START(UnityPerMaterial)
            float4 baseColorFactor;
            float4 baseColorTexture_ST;
            float4 baseColorTexture_Rotation;
            float4 _DetailBaseColor;
            float baseColorTexture_texCoord;
            float alphaCutoff;
            float _DetailStrength;
            float _InkStrength;
        CBUFFER_END

        float2 FighterUV(float2 uv0, float2 uv1)
        {
            float2 uv = lerp(uv0, uv1, step(0.5, baseColorTexture_texCoord));
            // glTFast stores the off-diagonal terms in (yx, xy) order.
            return uv * baseColorTexture_ST.xy + uv.yx * baseColorTexture_Rotation.yx + baseColorTexture_ST.zw;
        }

        half4 FighterTexture(float2 uv)
        {
            half4 texel = SAMPLE_TEXTURE2D(baseColorTexture, sampler_baseColorTexture, uv);
            #if defined(_ALPHATEST_ON)
                clip(texel.a * baseColorFactor.a - alphaCutoff);
            #endif
            return texel;
        }
        ENDHLSL

        Pass
        {
            Name "AnimeForward"
            Tags { "LightMode"="UniversalForward" }
            Cull [_Cull]
            ZWrite On
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FighterVertex
            #pragma fragment FighterFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile_fragment _ _SHADOWS_SOFT
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv0 : TEXCOORD0;
                float2 uv1 : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                half3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
                half fog : TEXCOORD3;
                UNITY_VERTEX_INPUT_INSTANCE_ID
                UNITY_VERTEX_OUTPUT_STEREO
            };
            Varyings FighterVertex(Attributes input)
            {
                Varyings output = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(output);
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.uv = FighterUV(input.uv0, input.uv1);
                output.fog = ComputeFogFactor(position.positionCS.z);
                return output;
            }
            half4 FighterFragment(Varyings input, FRONT_FACE_TYPE facing : FRONT_FACE_SEMANTIC) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(input);
                half4 texel = FighterTexture(input.uv);
                half3 albedo = lerp(SRGBToLinear(_DetailBaseColor.rgb), texel.rgb, _DetailStrength)
                    * SRGBToLinear(baseColorFactor.rgb);
                half3 normalWS = normalize(input.normalWS) * IS_FRONT_VFACE(facing, 1.0h, -1.0h);
                half3 viewWS = GetWorldSpaceNormalizeViewDir(input.positionWS);
                float4 shadowCoord = TransformWorldToShadowCoord(input.positionWS);
                #if defined(_MAIN_LIGHT_SHADOWS_SCREEN)
                    shadowCoord = ComputeScreenPos(TransformWorldToHClip(input.positionWS));
                #endif
                Light key = GetMainLight(shadowCoord);
                half illumination = saturate(dot(normalWS, key.direction)) * key.shadowAttenuation;
                // Three broad color bands with narrow antialiased transitions.
                half edge = max(fwidth(illumination), 0.018h);
                half middle = smoothstep(0.18h-edge, 0.18h+edge, illumination);
                half bright = smoothstep(0.65h-edge, 0.65h+edge, illumination);
                half3 shade = lerp(half3(0.43h,0.46h,0.59h), half3(0.74h,0.75h,0.83h), middle);
                shade = lerp(shade, half3(1.0h,0.98h,0.95h), bright);
                // A dark inner silhouette supplies ink without an extruded mesh pass.
                half viewDot = saturate(dot(normalWS, viewWS));
                half ink = (1.0h-smoothstep(0.06h,0.20h,viewDot)) * _InkStrength;
                half3 color = albedo * shade * clamp(key.color, 0.7h, 1.25h);
                color *= 1.0h-ink;
                return half4(MixFog(color, input.fog), 1);
            }
            ENDHLSL
        }
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode"="ShadowCaster" }
            ZWrite On
            ZTest LEqual
            ColorMask 0
            Cull [_Cull]
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex FighterShadowVertex
            #pragma fragment FighterShadowFragment
            #pragma shader_feature_local_fragment _ALPHATEST_ON
            #pragma multi_compile_vertex _ _CASTING_PUNCTUAL_LIGHT_SHADOW
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"
            float3 _LightDirection;
            float3 _LightPosition;
            struct ShadowAttributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv0 : TEXCOORD0;
                float2 uv1 : TEXCOORD1;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct ShadowVaryings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            ShadowVaryings FighterShadowVertex(ShadowAttributes input)
            {
                ShadowVaryings output = (ShadowVaryings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);
                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                #if defined(_CASTING_PUNCTUAL_LIGHT_SHADOW)
                    float3 lightDirection = normalize(_LightPosition-positionWS);
                #else
                    float3 lightDirection = _LightDirection;
                #endif
                output.positionCS = ApplyShadowClamping(TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, lightDirection)));
                output.uv = FighterUV(input.uv0, input.uv1);
                return output;
            }
            half4 FighterShadowFragment(ShadowVaryings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                FighterTexture(input.uv);
                return 0;
            }
            ENDHLSL
        }
    }
    Fallback Off
}
